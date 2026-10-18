/* GET /api/sitemap — XML sitemap, toggle-aware (exceed-the-brief).
   Off = excluded: disabled languages, hidden spotlight sections, unpublished
   articles, hidden journal posts. Per-language URLs with xhtml:link hreflang
   alternates, so Google indexes every live language correctly. */
const B = require('../lib/backend');

const LANGS = ['en', 'es', 'hi', 'gu', 'pa', 'fr', 'pt', 'de', 'it', 'ar', 'ja', 'ko', 'ru', 'zh'];
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STATIC_PATHS = ['/', '/watch', '/gallery', '/journal', '/partners', '/links', '/faq'];

module.exports = async (req, res) => {
  if (req.method !== 'GET') return B.json(res, 405, { ok: false });
  try {
    const db = B.supa();
    const [tg, arts, journal, premieres] = await Promise.all([
      db.from('toggles').select('key,enabled'),
      db.from('bt_articles').select('lang,slug,cat_key,published_at').eq('published', true),
      db.from('journal_posts').select('lang,slug,published_at').eq('show', true),
      db.from('reels').select('lang,item_key,premiere_at').eq('show', true).not('premiere_at', 'is', null),
    ]);
    const toggles = {};
    for (const t of ((tg.data || []))) toggles[t.key] = t.enabled !== false;
    const liveLangs = LANGS.filter(l => l === 'en' || toggles['lang_' + l] === true);
    const site = (process.env.SITE_URL || 'https://selenacole.com').replace(/\/$/, '');

    const urls = [];
    const alternates = (path) => liveLangs
      .map(l => `    <xhtml:link rel="alternate" hreflang="${l}" href="${site}/${l}${path}"/>`).join('\n');

    for (const p of STATIC_PATHS) {
      for (const l of liveLangs) {
        urls.push(`  <url>\n    <loc>${site}/${l}${p === '/' ? '' : p}</loc>\n${alternates(p)}\n  </url>`);
      }
    }
    for (const a of (arts.data || [])) {
      if (!liveLangs.includes(a.lang)) continue;
      const path = `/brutal-truth/${a.cat_key || 'vibes'}/${a.slug || a.article_key}`;
      const lastmod = a.published_at ? `\n    <lastmod>${a.published_at.slice(0, 10)}</lastmod>` : '';
      urls.push(`  <url>\n    <loc>${site}/${a.lang}${path}</loc>${lastmod}\n  </url>`);
    }
    for (const j of (journal.data || [])) {
      if (!liveLangs.includes(j.lang) || !j.slug) continue;
      const lastmod = j.published_at ? `\n    <lastmod>${j.published_at.slice(0, 10)}</lastmod>` : '';
      urls.push(`  <url>\n    <loc>${site}/${j.lang}/journal/${j.slug}</loc>${lastmod}\n  </url>`);
    }
    if (toggles.upgrade_premieres !== false) {
      for (const pr of (premieres.data || [])) {
        if (!liveLangs.includes(pr.lang)) continue;
        urls.push(`  <url>\n    <loc>${site}/${pr.lang}/premiere/${pr.item_key}</loc>\n  </url>`);
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`
      + `        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>`;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.end(xml);
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
