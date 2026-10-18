/* POST /api/admin/save {table, rows} — upsert rows by id (session required).
   Add / edit / hide — NEVER delete: there is no delete path here or anywhere
   in the Studio (STANDARDS.md 3.6 / 3.13).
   Every mutation snapshots the pre-save row into `versions` first (3.17).
   Tables: pages_content | reels | gallery_sets | gallery_items | journal_posts
   | bt_categories | bt_articles | chatbot_replies | faqs | enquiries |
   fan_messages | newsletter_signups | settings | toggles.
   Inbox tables (enquiries/fan_messages/newsletter_signups) accept status-only
   updates (triage), never content edits. */
const B = require('../../lib/backend');

const FIELDS = {
  pages_content: ['page', 'lang', 'title', 'subtitle', 'body', 'meta', 'show', 'sort'],
  reels: ['item_key', 'lang', 'sort', 'show', 'video_url', 'thumbnail_url', 'title', 'caption', 'mood', 'season', 'duration', 'featured', 'premiere_at'],
  gallery_sets: ['set_key', 'lang', 'title', 'description', 'cover_image', 'sort', 'show', 'season'],
  gallery_items: ['item_key', 'set_key', 'lang', 'sort', 'show', 'image_url', 'image_url_phone', 'caption', 'alt'],
  journal_posts: ['post_key', 'lang', 'title', 'slug', 'excerpt', 'body', 'cover_image', 'published_at', 'show'],
  bt_categories: ['cat_key', 'lang', 'name', 'slug', 'description', 'sort', 'show'],
  bt_articles: ['article_key', 'lang', 'cat_key', 'title', 'slug', 'excerpt', 'body', 'cover_image', 'published', 'published_at', 'sort', 'draft_note'],
  chatbot_replies: ['key', 'lang', 'question', 'answer', 'keywords', 'show'],
  faqs: ['key', 'lang', 'q', 'a', 'sort', 'show'],
  enquiries: ['status'],
  fan_messages: ['status'],
  newsletter_signups: ['status'],
};
const SETTINGS_KEYS = ['brand_name', 'tagline', 'hero_image', 'about_image', 'socials',
  'announcement', 'emails', 'theme', 'seasonal_skin', 'chatbot_name', 'chatbot_greeting', 'chatbot_fallback'];
const HAS_UPDATED_AT = new Set(['pages_content', 'reels', 'gallery_sets', 'gallery_items',
  'journal_posts', 'bt_categories', 'bt_articles', 'chatbot_replies', 'faqs']);

const slugify = s => String(s || '').toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';

function pick(row, fields) {
  const o = {};
  for (const f of fields) if (row[f] !== undefined) o[f] = row[f];
  return o;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return B.json(res, 405, { ok: false });
  if (!B.sessionValid(req)) return B.json(res, 401, { ok: false });
  try {
    const { table, rows } = await B.readBody(req);
    const db = B.supa();

    if (table === 'settings') {
      const patch = {};
      for (const r of (rows || [])) {
        if (!r || typeof r !== 'object') continue;
        Object.assign(patch, pick(r, SETTINGS_KEYS));
      }
      if (Object.keys(patch).length) {
        await B.snapshotVersion(db, 'site_settings', 'site_settings', null, 'site_settings', 'id', 1);
        patch.updated_at = new Date().toISOString();
        const { error } = await db.from('site_settings').upsert({ id: 1, ...patch }, { onConflict: 'id' });
        if (error) throw error;
      }
      return B.json(res, 200, { ok: true });
    }

    if (table === 'toggles') {
      for (const r of (rows || [])) {
        if (!r || typeof r !== 'object' || !r.key) continue;
        const { error } = await db.from('toggles')
          .upsert({ key: String(r.key), enabled: r.enabled !== false }, { onConflict: 'key' });
        if (error) throw error;
      }
      return B.json(res, 200, { ok: true });
    }

    const fields = FIELDS[table];
    if (!fields) return B.json(res, 400, { ok: false });
    let saved = 0;
    for (const r of (rows || [])) {
      if (!r || typeof r !== 'object') continue;
      const row = pick(r, fields);
      const hasId = r.id !== undefined && r.id !== null && r.id !== '';
      if (HAS_UPDATED_AT.has(table)) row.updated_at = new Date().toISOString();
      if (hasId) {
        await B.snapshotVersion(db, table, r.id, row.lang || null, table, 'id', r.id);
        const { error } = await db.from(table).update(row).eq('id', r.id);
        if (error) throw error;
      } else {
        // new row: mint a stable key when the table is keyed (page,lang) style
        if (fields.includes('page') && !row.page) continue;
        if (!row.lang && fields.includes('lang')) row.lang = 'en';
        for (const kf of ['item_key', 'set_key', 'post_key', 'cat_key', 'article_key', 'key', 'slug']) {
          if (fields.includes(kf) && !row[kf]) {
            row[kf] = slugify(row.title || row.name || row.q || row.question || kf) + '-' + Date.now().toString(36);
          }
        }
        const ins = await B.dbInsert(db, table, row);
        if (ins.error) throw ins.error;
      }
      saved++;
    }
    return B.json(res, 200, { ok: true, saved });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
