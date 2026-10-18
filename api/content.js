/* GET /api/content?lang= — the public content API.
   Only visible/enabled items, toggle-aware. Shape:
   { ok, pages, reels, gallery, journal, articles, faqs, settings, toggles, socials }
   Reads tables directly with NO caching — an admin save is live on the very
   next page load by construction (STANDARDS.md 3.14). */
const B = require('../lib/backend');

const LANGS = ['en', 'es', 'hi', 'gu', 'pa', 'fr', 'pt', 'de', 'it', 'ar', 'ja', 'ko', 'ru', 'zh'];

function pickI18n(obj, lang) {
  if (!obj || typeof obj !== 'object') return null;
  return obj[lang] || obj.en || null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return B.json(res, 405, { ok: false });
  try {
    let lang = 'en';
    try {
      const u = new URL(req.url, 'http://x');
      const q = (u.searchParams.get('lang') || 'en').toLowerCase();
      if (LANGS.includes(q)) lang = q;
    } catch (e) {}

    const db = B.supa();
    const tg = await db.from('toggles').select('key,enabled');
    if (tg.error) throw new Error('db');
    const toggles = {};
    for (const t of (tg.data || [])) toggles[t.key] = t.enabled !== false;
    // en is always on; other languages only when explicitly enabled in the Studio
    const effLang = (lang === 'en' || toggles['lang_' + lang] === true) ? lang : 'en';

    const [pages, reels, sets, items, journal, cats, arts, faqs, chat, set] = await Promise.all([
      db.from('pages_content').select('*').in('lang', effLang === 'en' ? ['en'] : [effLang, 'en']).eq('show', true),
      db.from('reels').select('*').eq('lang', effLang).eq('show', true).order('sort', { ascending: true }),
      db.from('gallery_sets').select('*').eq('lang', effLang).eq('show', true).order('sort', { ascending: true }),
      db.from('gallery_items').select('*').eq('lang', effLang).eq('show', true).order('sort', { ascending: true }),
      db.from('journal_posts').select('*').eq('lang', effLang).eq('show', true)
        .order('published_at', { ascending: false }).limit(50),
      db.from('bt_categories').select('*').eq('lang', effLang).eq('show', true).order('sort', { ascending: true }),
      db.from('bt_articles').select('*').eq('lang', effLang).eq('published', true)
        .order('published_at', { ascending: false }).limit(100),
      db.from('faqs').select('*').eq('lang', effLang).eq('show', true).order('sort', { ascending: true }),
      db.from('chatbot_replies').select('key').eq('lang', effLang).eq('show', true).limit(1),
      db.from('site_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    const errs = [pages, reels, sets, items, journal, cats, arts, faqs, chat, set]
      .map(r => r && r.error).filter(Boolean);
    if (errs.length) throw new Error('db');

    // English fallback: translated where available, en where a section has no rows yet
    let fb = null;
    const needFb = effLang !== 'en' && [reels, sets, journal, cats, arts, faqs]
      .some(r => !(r.data && r.data.length));
    if (needFb) {
      const [r2, s2, i2, j2, c2, a2, f2] = await Promise.all([
        db.from('reels').select('*').eq('lang', 'en').eq('show', true).order('sort', { ascending: true }),
        db.from('gallery_sets').select('*').eq('lang', 'en').eq('show', true).order('sort', { ascending: true }),
        db.from('gallery_items').select('*').eq('lang', 'en').eq('show', true).order('sort', { ascending: true }),
        db.from('journal_posts').select('*').eq('lang', 'en').eq('show', true).order('published_at', { ascending: false }).limit(50),
        db.from('bt_categories').select('*').eq('lang', 'en').eq('show', true).order('sort', { ascending: true }),
        db.from('bt_articles').select('*').eq('lang', 'en').eq('published', true).order('published_at', { ascending: false }).limit(100),
        db.from('faqs').select('*').eq('lang', 'en').eq('show', true).order('sort', { ascending: true }),
      ]);
      fb = { reels: r2, sets: s2, items: i2, journal: j2, cats: c2, arts: a2, faqs: f2 };
    }
    const use = (r, fbr) => (r.data && r.data.length) ? r.data : ((fb && fb[fbr] && fb[fbr].data) || []);

    const s = set.data || {};
    const abs = B.absUrl;
    // pages: requested language wins per page key, English fills missing pages
    const pagesByKey = {};
    for (const p of (pages.data || [])) {
      if (p.lang === effLang || !pagesByKey[p.page]) {
        pagesByKey[p.page] = {
          title: p.title, subtitle: p.subtitle, body: p.body || [],
          meta: p.meta || {},
        };
      }
    }

    // gallery: nest items under their sets (with en fallback)
    const gallerySets = use(sets, 'sets'), galleryItems = use(items, 'items');
    const itemsBySet = {};
    for (const it of galleryItems) {
      (itemsBySet[it.set_key] = itemsBySet[it.set_key] || []).push({
        id: it.id, caption: it.caption, alt: it.alt,
        image_url: abs(it.image_url), image_url_phone: abs(it.image_url_phone),
      });
    }
    let gallery = gallerySets.map(gs => ({
      key: gs.set_key, title: gs.title, description: gs.description,
      cover_image: abs(gs.cover_image), season: gs.season,
      items: itemsBySet[gs.set_key] || [],
    }));
    // spotlight sections obey the toggle board — off = fully excluded
    const spotlights = {
      section_aanya: toggles.section_aanya === true,
      section_nisha: toggles.section_nisha === true,
      section_kiara: toggles.section_kiara === true,
    };

    const settings = {
      brand_name: s.brand_name || 'Selena Cole',
      tagline: pickI18n(s.tagline, effLang),
      hero_image: abs(s.hero_image),
      about_image: abs(s.about_image),
      socials: s.socials || {},
      announcement: pickI18n(s.announcement, effLang),
      announcement_on: toggles.announcement_banner === true,
      emails: { partners: (s.emails || {}).partners || null, fan: (s.emails || {}).fan || null },
      theme: s.theme || 'gold',
      seasonal_skin: toggles.seasonal_skin === true ? (s.seasonal_skin || 'none') : 'none',
      chatbot: {
        on: toggles.chatbot !== false,
        name: s.chatbot_name || "Selena's Concierge",
        greeting: pickI18n(s.chatbot_greeting, effLang),
      },
      a11y_widget: toggles.a11y_widget !== false,
      upgrades: {
        presskit: toggles.upgrade_presskit !== false,
        premieres: toggles.upgrade_premieres !== false,
        email: toggles.upgrade_email !== false,
        qrsheet: toggles.upgrade_qrsheet !== false,
        hub: toggles.upgrade_hub !== false,
      },
      newsletter: toggles.newsletter_auto !== false,
    };

    return B.json(res, 200, {
      ok: true,
      lang: effLang,
      pages: pagesByKey,
      reels: use(reels, 'reels').map(r => ({
        key: r.item_key, title: r.title, caption: r.caption,
        video_url: r.video_url, thumbnail_url: abs(r.thumbnail_url),
        mood: r.mood, season: r.season, duration: r.duration,
        featured: !!r.featured, premiere_at: r.premiere_at,
      })),
      gallery,
      journal: use(journal, 'journal').map(j => ({
        key: j.post_key, title: j.title, slug: j.slug, excerpt: j.excerpt,
        body: j.body, cover_image: abs(j.cover_image), published_at: j.published_at,
      })),
      articles: use(arts, 'arts').map(a => ({
        key: a.article_key, cat: a.cat_key, title: a.title, slug: a.slug,
        excerpt: a.excerpt, body: a.body, cover_image: abs(a.cover_image),
        published_at: a.published_at,
      })),
      categories: use(cats, 'cats').map(c => ({
        key: c.cat_key, name: c.name, slug: c.slug, description: c.description,
      })),
      faqs: use(faqs, 'faqs').map(f => ({ q: f.q, a: f.a })),
      settings,
      toggles,
      socials: s.socials || {},
      spotlights,
      languages: LANGS.filter(l => l === 'en' || toggles['lang_' + l] === true),
    });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
