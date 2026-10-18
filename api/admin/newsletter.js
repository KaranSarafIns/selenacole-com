/* /api/admin/newsletter — Studio newsletter control (session required).
   GET ?issue_id= → one issue + its per-subscriber send log.
   POST {action, issue_id, ...}:
     update   {subject, sections} — edit a draft/approved issue (sent = read-only)
     approve                   — draft → approved (Raj's ONE-CLICK approve;
                                  nothing sends without this)
     unapprove                 — approved → draft (change of mind, before send)
     send_now                  — set scheduled_for=now on an approved issue;
                                  the cron still does the actual send
   Every edit snapshots a version first (3.17); approving/sending never deletes. */
const B = require('../../lib/backend');

function cleanSections(sections) {
  if (!Array.isArray(sections)) return null;
  return sections.slice(0, 24).map((s, i) => {
    s = s || {};
    return {
      id: String(s.id || 'sec-' + i).slice(0, 40),
      kind: String(s.kind || 'bts').slice(0, 20),
      title: String(s.title || '').slice(0, 160),
      body: String(s.body || '').slice(0, 8000),
      items: (Array.isArray(s.items) ? s.items : []).slice(0, 12).map(it => ({
        title: String(it.title || '').slice(0, 160),
        text: String(it.text || '').slice(0, 500),
        image_url: String(it.image_url || '').slice(0, 500),
        url: String(it.url || '').slice(0, 500),
        meta: String(it.meta || '').slice(0, 120),
        show: it.show !== false,
        sort: Number(it.sort || 0),
      })),
      options: (Array.isArray(s.options) ? s.options : []).slice(0, 6)
        .map(o => String(o).slice(0, 120)),
      show: s.show !== false,
      sort: Number(s.sort === undefined ? i : s.sort),
    };
  });
}

module.exports = async (req, res) => {
  if (!B.sessionValid(req)) return B.json(res, 401, { ok: false });
  const db = B.supa();

  if (req.method === 'GET') {
    try {
      let issue_id = '';
      try { issue_id = new URL(req.url, 'http://x').searchParams.get('issue_id') || ''; } catch (e) {}
      if (!issue_id) return B.json(res, 400, { ok: false });
      const [{ data: issue }, { data: sends }] = await Promise.all([
        db.from('newsletter_issues').select('*').eq('id', issue_id).maybeSingle(),
        db.from('newsletter_sends').select('email,status,attempts,error,sent_at')
          .eq('issue_id', issue_id).order('email'),
      ]);
      if (!issue) return B.json(res, 404, { ok: false });
      return B.json(res, 200, { ok: true, issue, sends: sends || [] });
    } catch (e) { return B.json(res, 500, { ok: false }); }
  }

  if (req.method !== 'POST') return B.json(res, 405, { ok: false });
  try {
    const { action, issue_id, subject, sections } = await B.readBody(req);
    if (!issue_id) return B.json(res, 400, { ok: false });
    const { data: issue } = await db.from('newsletter_issues')
      .select('*').eq('id', issue_id).maybeSingle();
    if (!issue) return B.json(res, 404, { ok: false });
    if (issue.status === 'sent' || issue.status === 'queued') {
      return B.json(res, 403, { ok: false, error: 'archived_or_sending' });
    }

    if (action === 'update') {
      const patch = { updated_at: new Date().toISOString() };
      if (subject !== undefined) patch.subject = String(subject).slice(0, 200);
      const cs = cleanSections(sections);
      if (cs) patch.sections = cs;
      await B.snapshotVersion(db, 'newsletter_issue', issue.id, null, 'newsletter_issues', 'id', issue.id);
      const { error } = await db.from('newsletter_issues').update(patch).eq('id', issue.id);
      if (error) throw error;
      return B.json(res, 200, { ok: true });
    }

    if (action === 'approve') {
      if (issue.status !== 'draft') return B.json(res, 400, { ok: false, error: 'not_draft' });
      await B.snapshotVersion(db, 'newsletter_issue', issue.id, null, 'newsletter_issues', 'id', issue.id);
      const { error } = await db.from('newsletter_issues')
        .update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', issue.id);
      if (error) throw error;
      return B.json(res, 200, { ok: true, status: 'approved' });
    }

    if (action === 'unapprove') {
      if (issue.status !== 'approved') return B.json(res, 400, { ok: false, error: 'not_approved' });
      await B.snapshotVersion(db, 'newsletter_issue', issue.id, null, 'newsletter_issues', 'id', issue.id);
      const { error } = await db.from('newsletter_issues')
        .update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', issue.id);
      if (error) throw error;
      return B.json(res, 200, { ok: true, status: 'draft' });
    }

    if (action === 'send_now') {
      if (issue.status !== 'approved') return B.json(res, 400, { ok: false, error: 'approve_first' });
      const { error } = await db.from('newsletter_issues')
        .update({ scheduled_for: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', issue.id);
      if (error) throw error;
      return B.json(res, 200, { ok: true, note: 'cron will pick it up on its next run' });
    }

    return B.json(res, 400, { ok: false });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
