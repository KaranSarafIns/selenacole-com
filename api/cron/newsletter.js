/* POST /api/cron/newsletter — the biweekly newsletter engine (idempotent).
   Auth: CRON_SECRET via `Authorization: Bearer <secret>` (or ?secret=).
   Wired to an external DAILY cron (~8:45am PT) — see BACKEND-NOTES.md;
   never created from here.

   Each run:
   1. If the `newsletter_auto` toggle is off → no-op.
   2. Draft: ensure exactly one open (draft/approved/queued) issue exists;
      create a pre-filled draft when none is open (scheduled_for = last slot + 14d).
   3. Send (approved issues only — NOTHING sends without Raj's Studio approval):
      claim due issues (approved → queued, single guarded UPDATE so concurrent
      runs can't double-send; stale 'queued' claims older than 1h are reclaimed,
      which is also how a partially-sent issue resumes on the next day's run).
      AUTO-BATCHING (Raj 2026-10-26): the Resend free tier caps the account at
      100 sends/day, so ONE run sends to at most DAILY_BATCH not-yet-sent
      confirmed subscribers per issue, with the budget shared across issues in
      the run so the daily total never exceeds it. Every send is recorded in
      newsletter_sends (UNIQUE(issue_id,email)) → fully idempotent: no
      subscriber ever receives the same issue twice, however often the
      endpoint is invoked. A partially-sent issue stays 'queued' (progress in
      sent_count) until every confirmed subscriber has a terminal row, then
      it is marked 'sent' with final stats.
      If Resend is not configured yet (no RESEND_API_KEY), nothing is burned:
      rows keep attempts=0 and the claim is released back to 'approved'.

   Returns a summary JSON of what the run did. Safe to call any time; a clean
   no-op when nothing is approved/due or everything due is already fully sent. */
const B = require('../../lib/backend');
const NL = require('../../lib/newsletter');
const { sendBatchNewsletter } = require('../../lib/notify');

/* Daily send cap — THE knob for the Resend plan limit (free tier: 100/day).
   Raise via env NEWSLETTER_DAILY_BATCH or by editing this default if Raj
   upgrades Resend; nothing else needs to change. */
const DAILY_BATCH = Math.max(1, parseInt(process.env.NEWSLETTER_DAILY_BATCH || '100', 10) || 100);
const MAX_ATTEMPTS = 2; // initial try + one retry (a retry lands on a later run)

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

async function countRows(db, issueId, pred) {
  const { data } = await db.from('newsletter_sends').select('status,attempts').eq('issue_id', issueId);
  return (data || []).filter(pred).length;
}

/* Send ONE daily batch (<= budget recipients) for a claimed issue.
   Returns a summary incl. budget_used and whether the issue is complete. */
async function sendIssue(db, issue, budget) {
  const summary = { issue_no: issue.issue_no, batch_sent: 0, batch_failed: 0, remaining: 0, complete: false, budget_used: 0 };

  // confirmed subscribers only; unsubscribed/pending never mailed
  const { data: subs, error: subErr } = await db.from('newsletter_signups')
    .select('email,token').eq('status', 'confirmed');
  if (subErr) throw subErr;
  const recipients = (subs || []).filter(s => s.email && s.token);

  // idempotent send rows (a subscriber who confirms mid-flow joins the issue;
  // existing rows are never duplicated thanks to UNIQUE(issue_id,email))
  for (const r of recipients) {
    await db.from('newsletter_sends').upsert(
      { issue_id: issue.id, email: r.email.toLowerCase(), status: 'pending', attempts: 0 },
      { onConflict: 'issue_id,email', ignoreDuplicates: true });
  }
  const tokenByEmail = {};
  for (const r of recipients) tokenByEmail[r.email.toLowerCase()] = r.token;

  // this run's batch: oldest unfinished rows first (stable order by email),
  // capped by the shared daily budget
  const { data: due } = await db.from('newsletter_sends')
    .select('email,attempts').eq('issue_id', issue.id)
    .in('status', ['pending', 'failed']).lt('attempts', MAX_ATTEMPTS)
    .order('email', { ascending: true }).limit(Math.max(0, budget));
  const batch = (due || []).filter(d => tokenByEmail[d.email]);

  if (batch.length) {
    const attemptsByEmail = {};
    for (const d of due) attemptsByEmail[d.email] = d.attempts || 0;

    const { data: set } = await db.from('site_settings').select('*').eq('id', 1).maybeSingle();
    const html = NL.buildIssueHtml(issue, set || {});
    const { results } = await sendBatchNewsletter({
      recipients: batch.map(d => ({ email: d.email, token: tokenByEmail[d.email] || '' })),
      subject: issue.subject, html });

    // Resend not configured yet → burn nothing: rows keep their attempts,
    // the caller releases the claim and the issue waits for the API key.
    if (results.length && results.every(r => r.reason === 'no_email_config')) {
      summary.blocked = 'email_not_configured';
      return summary;
    }

    summary.budget_used = results.length;
    for (const r of results) {
      const ok = !!r.sent;
      await db.from('newsletter_sends').update({
        status: ok ? 'sent' : 'failed',
        attempts: (attemptsByEmail[r.email] || 0) + 1,
        error: ok ? null : String(r.reason || 'send_failed').slice(0, 200),
        sent_at: new Date().toISOString(),
      }).eq('issue_id', issue.id).eq('email', r.email);
      if (ok) summary.batch_sent++; else summary.batch_failed++;
    }
  }

  // progress + completion: an issue is complete when no row still owes a send
  // (pending, or failed with a retry left). Newly confirmed subscribers were
  // upserted above, so they are counted before completion can be declared.
  const sent = await countRows(db, issue.id, c => c.status === 'sent');
  const failedFinal = await countRows(db, issue.id, c => c.status === 'failed' && (c.attempts || 0) >= MAX_ATTEMPTS);
  const remaining = await countRows(db, issue.id,
    c => c.status === 'pending' || (c.status === 'failed' && (c.attempts || 0) < MAX_ATTEMPTS));
  summary.remaining = remaining;
  summary.complete = remaining === 0;

  if (summary.complete) {
    // sent issues are archived read-only in the Studio — never deleted
    await db.from('newsletter_issues').update({
      status: 'sent', sent_at: new Date().toISOString(),
      sent_count: sent, failed_count: failedFinal,
      updated_at: new Date().toISOString(),
    }).eq('id', issue.id);
    // version-safety: the sent snapshot stays in versions history
    await B.snapshotVersion(db, 'newsletter_issue', issue.id, null, 'newsletter_issues', 'id', issue.id);
  } else {
    // partial batch: stay 'queued' (in-flight), record progress; the next
    // daily run reclaims the stale claim and continues where this one stopped
    await db.from('newsletter_issues').update({
      sent_count: sent, failed_count: failedFinal,
      updated_at: new Date().toISOString(),
    }).eq('id', issue.id);
  }
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

    let budget = DAILY_BATCH; // shared across issues: the daily cap is account-wide
    const now = new Date().toISOString();
    const { data: ready } = await db.from('newsletter_issues')
      .select('id,issue_no,subject,sections,scheduled_for,status,updated_at')
      .in('status', ['approved', 'queued']).lte('scheduled_for', now)
      .order('scheduled_for', { ascending: true });
    for (const issue of (ready || [])) {
      if (budget <= 0) break; // today's cap is spent — the rest flows tomorrow
      if (issue.status === 'queued') {
        // only reclaim stale claims here; fresh ones belong to a live run
        if (issue.updated_at > new Date(Date.now() - 3600 * 1000).toISOString()) continue;
      }
      const claimed = await claimIssue(db, issue);
      if (!claimed) continue; // lost the race — another run has it
      try {
        const s = await sendIssue(db, claimed, budget);
        budget -= s.budget_used || 0;
        if (s.blocked) {
          // no mail config yet: release the claim so nothing is stuck 'queued'
          await db.from('newsletter_issues').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', issue.id);
          out.note = 'email_not_configured — sends wait for RESEND_API_KEY';
          out.sent.push({ issue_no: issue.issue_no, blocked: s.blocked });
        } else {
          out.sent.push({ issue_no: s.issue_no, batch_sent: s.batch_sent, batch_failed: s.batch_failed, remaining: s.remaining, complete: s.complete });
        }
      } catch (e) {
        // release the claim back to approved so a later run retries
        await db.from('newsletter_issues').update({ status: 'approved' }).eq('id', issue.id);
        out.sent.push({ issue_no: issue.issue_no, error: 'send_crashed_requeued' });
      }
    }
    return B.json(res, 200, out);
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
