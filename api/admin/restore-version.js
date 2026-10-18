/* POST /api/admin/restore-version {version_id} — restore a content item from a
   versions row (session required). Restoring snapshots the CURRENT state first,
   so a bad restore is itself undoable (STANDARDS.md 3.17). Works for content
   tables, site_settings, and newsletter_issues. Sent newsletter issues are
   read-only and cannot be restored. */
const B = require('../../lib/backend');

const TABLE_OF = {
  pages_content: 'pages_content', reels: 'reels', gallery_sets: 'gallery_sets',
  gallery_items: 'gallery_items', journal_posts: 'journal_posts',
  bt_categories: 'bt_categories', bt_articles: 'bt_articles',
  chatbot_replies: 'chatbot_replies', faqs: 'faqs',
  site_settings: 'site_settings', newsletter_issue: 'newsletter_issues',
};
// columns that must never be overwritten by a restore
const PROTECT = new Set(['id', 'created_at', 'issue_no', 'status', 'scheduled_for',
  'sent_at', 'sent_count', 'failed_count', 'seed_original']);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return B.json(res, 405, { ok: false });
  if (!B.sessionValid(req)) return B.json(res, 401, { ok: false });
  try {
    const { version_id } = await B.readBody(req);
    if (!version_id) return B.json(res, 400, { ok: false });
    const db = B.supa();
    const { data: v, error: vErr } = await db.from('versions')
      .select('*').eq('id', version_id).maybeSingle();
    if (vErr || !v) return B.json(res, 404, { ok: false });
    const table = TABLE_OF[v.item_type];
    if (!table) return B.json(res, 400, { ok: false });

    // sent newsletter issues are archived read-only
    if (v.item_type === 'newsletter_issue') {
      const { data: cur } = await db.from('newsletter_issues')
        .select('status').eq('id', v.item_id).maybeSingle();
      if (cur && cur.status === 'sent') return B.json(res, 403, { ok: false, error: 'archived' });
    }

    const patch = {};
    for (const [k, val] of Object.entries(v.data || {})) {
      if (!PROTECT.has(k)) patch[k] = val;
    }
    patch.updated_at = new Date().toISOString();

    // snapshot current state BEFORE applying (undoable restore)
    if (v.item_type === 'site_settings') {
      await B.snapshotVersion(db, 'site_settings', 'site_settings', null, 'site_settings', 'id', 1);
      const { error } = await db.from('site_settings').update(patch).eq('id', 1);
      if (error) throw error;
    } else {
      await B.snapshotVersion(db, v.item_type, v.item_id, v.lang, table, 'id', v.item_id);
      const { error } = await db.from(table).update(patch).eq('id', v.item_id);
      if (error) throw error;
    }
    return B.json(res, 200, { ok: true });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
