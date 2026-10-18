/* POST /api/cron/newsletter — the biweekly newsletter engine (idempotent).
   Auth: CRON_SECRET via `Authorization: Bearer <secret>` (or ?secret=).
   Wired to an external cron (e.g. every 6h) — DOCUMENTED in BACKEND-NOTES.md;
   never created from here.

   Each run:
   1. If the `newsletter_auto` toggle is off → no-op.
   2. Draft: ensure exactly one open (draft/approved/queued) issue exists;
      create a pre-filled draft when none is open (scheduled_for = last slot + 14d).
   3. Send: claim approved issues whose scheduled_for <= now (approved → queued,
      single UPDATE … WHERE status='approved' so concurrent runs can't double-send;
      stale 'queued' claims older than 1h are reclaimed). Insert per-subscriber
      send rows for confirmed subscribers (UNIQUE(issue_id,email) = idempotent),
      batch-send via Resend, retry failed once, then mark sent with stats.
      NOTHING sends without Raj's Studio approval (status must be 'approved').

   Returns a summary JSON of what the run did. Safe to call any time. */
const B = require('../../lib/backend');
const NL = require('../../lib/newsletter');
const { sendBatchNewsletter } = require('../../lib/notify');

const MAX_ATTEMPTS = 2; // initial try + one retry

async function claimIssue(db, issue) {
  // single guarded transition: approved -> queued (or reclaim stale queued)
  const stale = new Date(Date.now() - 3600 * 1000).toISOString();
  const { data, error } = await db.from('newsletter_issues')
    .update({ status: 'queued', updated_at: new Date().toISOString() })
    .eq('id', issue.id)
    .or(`status.eq.approved,and(status.eq.queued,updated_at.lt.${stale})`)
    .select('id,issue_no,subject,sections,status');
  if (error) throw error;
  return (data && data[0]) || null;
}

async function sendIssue(db, issue) {
  const summary = { issue_no: issue.issue_no, sent: 0, failed: 0, skipped: 0 };
  const sentEmails = new Set(), failedEmails = new Set();

  // confirmed subscribers only; unsubscribed/pending never mailed
  const { data: subs, error: subErr } = await db.from('newsletter_signups')
    .select('email,token').eq('status', 'confirmed');
  if (subErr) throw subErr;
  const recipients = (subs || []).filter(s => s.email && s.token);

  // idempotent send rows
  for (const r of recipients) {
    await db.from('newsletter_sends').upsert(
      { issue_id: issue.id, email: r.email.toLowerCase(), status: 'pending', attempts: 0 },
      { onConflict: 'issue_id,email', ignoreDuplicates: true });
  }

  const tokenByEmail = {};
  for (const r of recipients) tokenByEmail[r.email.toLowerCase()] = r.token;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data: due } = await db.from('newsletter_sends')
      .select('email').eq('issue_id', issue.id)
      .in('status', ['pending', 'failed']).lt('attempts', attempt);
    const batch = (due || []).map(d => ({ email: d.email, token: tokenByEmail[d.email] || '' }))
      .filter(x => x.token);
    summary.skipped += (due || []).length - batch.length;
    if (!batch.length) break;

    const { data: set } = await db.from('site_settings').select('*').eq('id', 1).maybeSingle();
    const html = NL.buildIssueHtml(issue, set || {});
    const { results } = await sendBatchNewsletter({ recipients: batch, subject: issue.subject, html });
    for (const r of results) {
      const ok = !!r.sent;
      await db.from('newsletter_sends').update({
        status: ok ? 'sent' : 'failed',
        attempts: attempt,
        error: ok ? null : String(r.reason || 'send_failed').slice(0, 200),
        sent_at: new Date().toISOString(),
      }).eq('issue_id', issue.id).eq('email', r.email);
      if (ok) { sentEmails.add(r.email); failedEmails.delete(r.email); }
      else { failedEmails.add(r.email); }
    }
  }
  summary.sent = sentEmails.size;
  summary.failed = failedEmails.size;

  const { data: counts } = await db.from('newsletter_sends')
    .select('status').eq('issue_id', issue.id);
  const sent = (counts || []).filter(c => c.status === 'sent').length;
  const failed = (counts || []).filter(c => c.status === 'failed').length;

  // sent issues are archived read-only in the Studio — never deleted
  await db.from('newsletter_issues').update({
    status: 'sent', sent_at: new Date().toISOString(),
    sent_count: sent, failed_count: failed,
    updated_at: new Date().toISOString(),
  }).eq('id', issue.id);

  // version-safety: the sent snapshot stays in versions history
  await B.snapshotVersion(db, 'newsletter_issue', issue.id, null, 'newsletter_issues', 'id', issue.id);
  return summary;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return B.json(res, 405, { ok: false });
  if (!B.cronAuthorized(req)) return B.json(res, 401, { ok: false });
  const out = { ok: true, drafted: null, sent: [] };
  try {
    const db = B.supa();
    const { data: tg } = await db.from('toggles').select('enabled').eq('key', 'newsletter_auto').maybeSingle();
    if (tg && tg.enabled === false) {
      out.note = 'newsletter_auto toggle is off — nothing drafted or sent';
      return B.json(res, 200, out);
    }

    const d = await NL.draftNextIssue(db);
    if (d.created) out.drafted = { issue_no: d.issue.issue_no, scheduled_for: d.issue.scheduled_for };

    const now = new Date().toISOString();
    const { data: ready } = await db.from('newsletter_issues')
      .select('id,issue_no,subject,sections,scheduled_for,status,updated_at')
      .in('status', ['approved', 'queued']).lte('scheduled_for', now)
      .order('scheduled_for', { ascending: true });
    for (const issue of (ready || [])) {
      if (issue.status === 'queued') {
        // only reclaim stale claims here; fresh ones belong to a live run
        if (issue.updated_at > new Date(Date.now() - 3600 * 1000).toISOString()) continue;
      }
      const claimed = await claimIssue(db, issue);
      if (!claimed) continue; // lost the race — another run has it
      try {
        out.sent.push(await sendIssue(db, claimed));
      } catch (e) {
        // release the claim back to approved so a later run retries
        await db.from('newsletter_issues').update({ status: 'approved' }).eq('id', issue.id);
        out.sent.push({ issue_no: issue.issue_no, error: 'send_crashed_requeued' });
      }
    }
    return B.json(res, 200, out);
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
