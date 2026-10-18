#!/usr/bin/env node
/* Seed script — SelenaCole.com backend.
   Reads content/<lang>.json (14 langs; skips missing/broken files loudly) and
   media/MANIFEST.json, upserts into site_selenacole, writes seed_original
   version rows (STANDARDS.md 3.17).

   Modes:
     node scripts/seed.js            insert-missing-only (safe to rerun anytime;
                                     never clobbers Studio edits)
     node scripts/seed.js --refresh  re-upsert text fields from files (versions
                                     snapshotted first; show/sort flags kept)

   Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_SCHEMA (=site_selenacole).

   Content contract (content track's format):
     top-level sections: nav, hero, home, about, watch, gallery, journal,
     partners, contact, brutal_truth, footer, privacy, terms, links_page,
     newsletter, chatbot{name,opening,fallback,quick_replies,qa[{q,a}]},
     a11y, meta, articles[{slug,category,title,excerpt,h1,meta_description,body_html}]
   Media manifest slots: hero, about_1, gallery_set_1/2/3 (arrays),
     watch_featured, watch_items (array), duo_bridge, spotlight_aanya/nisha/kiara.

   The partnership-line fix from the plan (Partners@AanyaRai.com →
   Partners@SelenaCole.com) is applied to article bodies while loading. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');           // ~/workspace/selenacole-com
const CONTENT_DIR = path.join(ROOT, 'content');
const MANIFEST = path.join(ROOT, 'media', 'MANIFEST.json');
const SITE_DIR = path.join(ROOT, 'site');
const LANGS = ['en', 'es', 'hi', 'gu', 'pa', 'fr', 'pt', 'de', 'it', 'ar', 'ja', 'ko', 'ru', 'zh'];
const REFRESH = process.argv.includes('--refresh');
const RESYNC_CHAT = process.argv.includes('--resync-chat');

const SCHEMA = process.env.SUPABASE_SCHEMA || 'site_selenacole';
let _db = null;
function db() {
  if (_db) return _db;
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  _db = createClient(url, key, { auth: { persistSession: false } }).schema(SCHEMA);
  return _db;
}

const stats = { inserted: 0, skipped: 0, refreshed: 0, versions: 0, cleaned: 0 };
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return { __broken: String(e.message || e).slice(0, 120) }; }
}

let manifest = { slots: {} };
const mraw = readJson(MANIFEST);
if (mraw && !mraw.__broken) manifest = mraw;

/* manifest "file" values are site-relative already (assets/...) → public URL */
function pubFile(f) {
  f = String(f || '');
  if (!f) return '';
  if (/^https?:\/\//i.test(f) || f.charAt(0) === '/') return f;
  return '/' + f;
}
function slotUrl(name) {
  const s = (manifest.slots || {})[name];
  return s && s.file ? pubFile(s.file) : '';
}
function slotAlt(name) {
  const s = (manifest.slots || {})[name];
  return (s && s.alt) || '';
}

async function ensure(table, uniq, row) {
  const d = db();
  let q = d.from(table).select('*');
  for (const [k, v] of Object.entries(uniq)) q = q.eq(k, v);
  const { data: ex, error: e1 } = await q.maybeSingle();
  if (e1) throw e1;
  if (ex) { stats.skipped++; return { row: ex, created: false }; }
  const { data, error } = await d.from(table).insert(row).select('*').single();
  if (error) throw error;
  stats.inserted++;
  await seedOriginal(table, data);
  return { row: data, created: true };
}

async function seedOriginal(itemType, row) {
  const snap = { ...row };
  delete snap.created_at; delete snap.updated_at;
  const { error } = await db().from('versions').insert({
    item_type: itemType, item_id: String(row.id), lang: row.lang || null,
    data: snap, seed_original: true,
  });
  if (error) throw error;
  stats.versions++;
}

const slugify = s => String(s || '').toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';

/* ---------- always-seeded: toggle board ---------- */
const TOGGLES = [
  ['section', 'section_aanya', true, 'Aanya spotlight section (Team Selena bridge)'],
  ['section', 'section_nisha', false, 'Nisha spotlight section'],
  ['section', 'section_kiara', false, 'Kiara spotlight section'],
  ['language', 'lang_en', true, 'English'], ['language', 'lang_es', false, 'Spanish'],
  ['language', 'lang_hi', false, 'Hindi'], ['language', 'lang_gu', false, 'Gujarati'],
  ['language', 'lang_pa', false, 'Punjabi'], ['language', 'lang_fr', false, 'French'],
  ['language', 'lang_pt', false, 'Portuguese'], ['language', 'lang_de', false, 'German'],
  ['language', 'lang_it', false, 'Italian'], ['language', 'lang_ar', false, 'Arabic (RTL)'],
  ['language', 'lang_ja', false, 'Japanese'], ['language', 'lang_ko', false, 'Korean'],
  ['language', 'lang_ru', false, 'Russian'], ['language', 'lang_zh', false, 'Chinese (Simplified)'],
  ['feature', 'chatbot', true, "Selena's Concierge chatbot"],
  ['feature', 'a11y_widget', true, 'Accessibility widget (on by default)'],
  ['feature', 'seasonal_skin', false, 'Seasonal skin (Halloween first)'],
  ['feature', 'announcement_banner', false, 'Announcement banner'],
  ['upgrade', 'upgrade_presskit', true, 'Auto press kit (Partners PDF from live data)'],
  ['upgrade', 'upgrade_premieres', true, 'Premiere pages (countdown + signup per big reel)'],
  ['upgrade', 'upgrade_email', true, 'Email capture from day one'],
  ['upgrade', 'upgrade_qrsheet', true, 'Printable QR sheet'],
  ['upgrade', 'upgrade_hub', true, 'Hub-ready build (shared patterns for TeamSelenaCole.com)'],
  ['newsletter', 'newsletter_auto', true, 'Biweekly auto-newsletter (draft + send via cron)'],
];

/* Remove my own early stub scaffolding (unpublished, empty) once real content
   arrives — these were seed placeholders, never Raj's content. */
const STUB_ARTICLE_KEYS = ['squat-proof-leggings', 'silk-robe-fantasy', 'mens-boxer-briefs',
  '24-hour-eyeliner', 'oversized-sunglasses', 'dance-bag-logistics', 'erasing-stage-makeup',
  'mens-grooming-note', 'seamless-illusion', 'ring-light-alien'];
async function cleanupStubs() {
  const d = db();
  const { data: stubs } = await d.from('bt_articles').select('id')
    .eq('lang', 'en').eq('published', false).eq('body', '').eq('excerpt', '')
    .in('article_key', STUB_ARTICLE_KEYS);
  for (const s of (stubs || [])) {
    await d.from('versions').delete().eq('item_type', 'bt_articles').eq('item_id', String(s.id));
    await d.from('bt_articles').delete().eq('id', s.id);
    stats.cleaned++;
  }
  for (const ck of ['vibes', 'guys-guide']) {
    const { data: arts } = await d.from('bt_articles').select('id').eq('cat_key', ck).limit(1);
    if (!arts || !arts.length) {
      const { data: cat } = await d.from('bt_categories').select('id').eq('cat_key', ck).eq('lang', 'en').maybeSingle();
      if (cat) {
        await d.from('versions').delete().eq('item_type', 'bt_categories').eq('item_id', String(cat.id));
        await d.from('bt_categories').delete().eq('id', cat.id);
        stats.cleaned++;
      }
    }
  }
}

async function seedBase() {
  const d = db();
  for (const [grp, key, enabled, label] of TOGGLES) {
    const { data: ex } = await d.from('toggles').select('key').eq('key', key).maybeSingle();
    if (!ex) {
      const { error } = await d.from('toggles').insert({ key, enabled, label, grp });
      if (error) throw error;
      stats.inserted++;
    } else stats.skipped++;
  }
  const { data: set } = await d.from('site_settings').select('id').eq('id', 1).maybeSingle();
  if (!set) {
    const { error } = await d.from('site_settings').insert({
      id: 1, brand_name: 'Selena Cole', theme: 'gold', seasonal_skin: 'halloween',
      chatbot_name: "Selena's Concierge",
      hero_image: slotUrl('hero'), about_image: slotUrl('about_1'),
      emails: { partners: 'Partners@SelenaCole.com', fan: 'Selena@SelenaCole.com' },
      socials: {},
    });
    if (error) throw error;
    stats.inserted++;
  } else {
    // keep media paths fresh on the settings row (Studio can override after)
    const { error } = await d.from('site_settings').update({
      hero_image: slotUrl('hero'), about_image: slotUrl('about_1'),
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    if (error) throw error;
    stats.skipped++;
  }

  // functional chatbot rows (Studio-editable).
  // STANDING RULE (Raj, locked): the concierge NEVER pretends to be Selena.
  await ensure('chatbot_replies', { key: 'identity', lang: 'en' }, {
    key: 'identity', lang: 'en',
    question: 'are you really Selena? is this Selena?',
    answer: "I'm Selena's Concierge \u2014 her AI-powered helper, here 24/7 to answer questions about her reels, shoots and journal. I'm not Selena herself, but I'll do my best to help! \u{1F49B}",
    keywords: 'really you,real selena,are you selena,is this selena,who are you,robot,ai,artificial',
    show: true,
  });
  await ensure('chatbot_replies', { key: 'partner_handoff', lang: 'en' }, {
    key: 'partner_handoff', lang: 'en',
    question: 'partnership / business enquiry',
    answer: "Ooh, business talk \u2014 I like it. My team handles all of that on the Partners page: tell them what you have in mind and they'll get right back to you \u{1F49B}",
    keywords: 'partner,business,collab,collaboration,brand,sponsor,advertising,press,booking,hire',
    show: true,
  });
}

/* ---------- media-driven seeds (visual structure, en source) ---------- */
const GALLERY_SETS = [
  { key: 'golden-hour', slot: 'gallery_set_1', title: 'Golden Hour', desc: 'Rooftop sunsets, gold light, champagne moods.' },
  { key: 'resort-days', slot: 'gallery_set_2', title: 'Resort Days', desc: 'Yachts, white dresses and slow afternoons.' },
  { key: 'city-nights', slot: 'gallery_set_3', title: 'City Nights', desc: 'After dark — marble, satin and skyline.' },
];
async function seedMedia() {
  const d = db();
  let sort = 0;
  for (const gs of GALLERY_SETS) {
    const arr = ((manifest.slots || {})[gs.slot]) || [];
    if (!arr.length) continue;
    const { row: setRow } = await ensure('gallery_sets', { set_key: gs.key, lang: 'en' }, {
      set_key: gs.key, lang: 'en', title: gs.title, description: gs.desc,
      cover_image: pubFile(arr[0].file), sort: sort++, show: true, season: '',
    });
    let j = 0;
    for (const it of arr) {
      await ensure('gallery_items', { item_key: `${gs.key}-${j + 1}`, lang: 'en' }, {
        item_key: `${gs.key}-${j + 1}`, set_key: gs.key, lang: 'en', sort: j++,
        show: true, image_url: pubFile(it.file), image_url_phone: pubFile(it.file),
        caption: '', alt: it.alt || '',
      });
    }
  }
  // watch theatre scaffolding: real videos get swapped in via the Studio
  const feat = (manifest.slots || {}).watch_featured;
  const watchItems = ((manifest.slots || {}).watch_items) || [];
  if (feat || watchItems.length) {
    let i = 0;
    const mk = async (key, it, featured, n) => {
      await ensure('reels', { item_key: key, lang: 'en' }, {
        item_key: key, lang: 'en', sort: i++, show: false,
        video_url: '', thumbnail_url: it ? pubFile(it.file) : '',
        title: featured ? 'Featured premiere (swap in Studio)' : `Reel ${n} (swap in Studio)`,
        caption: it ? it.alt || '' : '', mood: '', season: '',
        duration: '', featured: !!featured, premiere_at: null,
      });
    };
    if (feat) await mk('featured-premiere', feat, true, 0);
    let n = 0;
    for (const it of watchItems) { n++; await mk(`reel-slot-${n}`, it, false, n); }
  }
  // visual pages: spotlights + Team Selena bridge
  const pages = [
    ['spotlight_aanya', 'spotlight_aanya', 'Aanya Rai'],
    ['spotlight_nisha', 'spotlight_nisha', 'Nisha'],
    ['spotlight_kiara', 'spotlight_kiara', 'Kiara'],
    ['bridge', 'duo_bridge', 'Team Selena'],
  ];
  for (const [page, slot, title] of pages) {
    const url = slotUrl(slot);
    if (!url) continue;
    await ensure('pages_content', { page, lang: 'en' }, {
      page, lang: 'en', title, subtitle: '',
      body: [{ k: 'visual', v: { image: url, alt: slotAlt(slot) } }],
      meta: {}, show: true, sort: 0,
    });
  }
}

/* ---------- per-language content files ---------- */
function fixPartners(s) {
  return String(s || '').replace(/AanyaRai\.com/gi, 'SelenaCole.com');
}

async function seedLang(lang, doc) {
  const d = db();
  const upd = async (table, uniq, row, keepFlags) => {
    const { row: existing, created } = await ensure(table, uniq, row);
    if (!created && REFRESH) {
      const patch = { ...row };
      for (const f of (keepFlags || [])) delete patch[f];
      patch.updated_at = new Date().toISOString();
      const { data: cur } = await d.from(table).select('*').eq('id', existing.id).maybeSingle();
      if (cur) {
        const snap = { ...cur }; delete snap.created_at; delete snap.updated_at;
        await d.from('versions').insert({
          item_type: table, item_id: String(existing.id), lang: cur.lang || null,
          data: snap, seed_original: false,
        });
        stats.versions++;
      }
      const { error } = await d.from(table).update(patch).eq('id', existing.id);
      if (error) throw error;
      stats.refreshed++;
    }
  };
  const K = (sec, def) => (doc[sec] === undefined ? def : doc[sec]);
  const meta = doc.meta || {};

  const pageDefs = [
    ['home', (doc.hero || {}).line || '', (doc.home || {}).intro_text || '',
      [{ k: 'nav', v: K('nav', {}) }, { k: 'hero', v: K('hero', {}) },
       { k: 'home', v: K('home', {}) }, { k: 'newsletter', v: K('newsletter', {}) }],
      { title: meta.home_title || '', description: meta.home_description || '' }],
    ['about', (doc.about || {}).title || '', '', [{ k: 'about', v: K('about', {}) }],
      { title: meta.about_title || '', description: meta.about_description || '' }],
    ['watch', (doc.watch || {}).title || '', (doc.watch || {}).intro || '', [{ k: 'watch', v: K('watch', {}) }],
      { title: meta.watch_title || '', description: meta.watch_description || '' }],
    ['gallery', (doc.gallery || {}).title || '', (doc.gallery || {}).intro || '', [{ k: 'gallery', v: K('gallery', {}) }],
      { title: meta.gallery_title || '', description: meta.gallery_description || '' }],
    ['journal', (doc.journal || {}).title || '', (doc.journal || {}).intro || '', [{ k: 'journal', v: K('journal', {}) }],
      { title: meta.journal_title || '', description: meta.journal_description || '' }],
    ['partners', (doc.partners || {}).title || '', (doc.partners || {}).intro || '', [{ k: 'partners', v: K('partners', {}) }],
      { title: meta.partners_title || '', description: meta.partners_description || '' }],
    ['contact', (doc.contact || {}).title || '', (doc.contact || {}).intro || '', [{ k: 'contact', v: K('contact', {}) }],
      { title: meta.contact_title || '', description: meta.contact_description || '' }],
    ['brutal_truth', (doc.brutal_truth || {}).title || '', (doc.brutal_truth || {}).intro || '',
      [{ k: 'brutal_truth', v: K('brutal_truth', {}) }],
      { title: meta.brutal_truth_title || '', description: meta.brutal_truth_description || '' }],
    ['privacy', (doc.privacy || {}).title || '', '', [{ k: 'privacy', v: K('privacy', {}) }], {}],
    ['terms', (doc.terms || {}).title || '', '', [{ k: 'terms', v: K('terms', {}) }], {}],
    ['links', (doc.links_page || {}).heading || '', '', [{ k: 'links_page', v: K('links_page', {}) }], {}],
    ['footer', '', '', [{ k: 'footer', v: K('footer', {}) }], {}],
    ['a11y', '', '', [{ k: 'a11y', v: K('a11y', {}) }], {}],
  ];
  for (const [page, title, subtitle, body, metaObj] of pageDefs) {
    await upd('pages_content', { page, lang },
      { page, lang, title, subtitle, body, meta: metaObj, show: true, sort: 0 },
      ['show', 'sort']);
  }

  // brutal truth articles (the 10-piece starter pack, per language)
  const seenCats = new Set();
  let aSort = 0;
  for (const a of (doc.articles || [])) {
    const slugFull = String(a.slug || '');
    const parts = slugFull.split('/').filter(Boolean);
    const akey = parts.length ? parts[parts.length - 1] : slugify(a.title);
    const ckey = slugify(a.category || 'vibes');
    if (!seenCats.has(ckey)) {
      seenCats.add(ckey);
      await upd('bt_categories', { cat_key: ckey, lang },
        { cat_key: ckey, lang, name: a.category || ckey, slug: ckey, description: '', show: true, sort: seenCats.size },
        ['show', 'sort']);
    }
    await upd('bt_articles', { article_key: akey, lang }, {
      article_key: akey, lang, cat_key: ckey, title: a.title || '', slug: akey,
      excerpt: fixPartners(a.excerpt || ''), body: fixPartners(a.body_html || ''),
      cover_image: '', published: true, published_at: new Date().toISOString(),
      sort: aSort++,
    }, ['published', 'sort']);
  }

  // chatbot Q&A → replies (keywords derived from the question's long words)
  const cb = doc.chatbot || {};
  let qi = 0;
  for (const qa of (cb.qa || [])) {
    const q = String(qa.q || ''), an = String(qa.a || '');
    if (!q || !an) continue;
    const kws = q.toLowerCase().split(/[^a-z\u00e0-\u024f\u4e00-\u9fff\u0900-\u097f]+/)
      .filter(w => w.length >= 5).slice(0, 8).join(',');
    await upd('chatbot_replies', { key: slugify(q).slice(0, 50) + '-' + lang, lang }, {
      key: slugify(q).slice(0, 50) + '-' + lang, lang,
      question: q, answer: an, keywords: kws, show: true,
    }, ['show']);
    qi++;
  }

  // per-language settings merges
  const patch = {};
  const mergeI18n = async (col, val) => {
    if (val === undefined || val === '') return;
    const { data: cur } = await d.from('site_settings').select(col).eq('id', 1).maybeSingle();
    patch[col] = { ...((cur && cur[col]) || {}), [lang]: val };
  };
  await mergeI18n('tagline', (doc.footer || {}).tagline);
  await mergeI18n('chatbot_greeting', cb.opening);
  await mergeI18n('chatbot_fallback', cb.fallback);
  if ((doc.contact || {}).fan_email || (doc.contact || {}).business_email) {
    const { data: cur } = await d.from('site_settings').select('emails').eq('id', 1).maybeSingle();
    patch.emails = {
      ...((cur && cur.emails) || {}),
      fan: doc.contact.fan_email || ((cur && cur.emails) || {}).fan,
      partners: doc.contact.business_email || ((cur && cur.emails) || {}).partners,
    };
  }
  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    const { error } = await d.from('site_settings').update(patch).eq('id', 1);
    if (error) throw error;
    stats.refreshed++;
  }
}

async function main() {
  console.log(`seed ${REFRESH ? '--refresh' : ''}${RESYNC_CHAT ? '--resync-chat' : ''} (insert-missing-only) → schema ${SCHEMA}`);
  await seedBase();
  await cleanupStubs();
  await seedMedia();
  let langsFound = 0;
  const broken = [];
  for (const lang of LANGS) {
    const p = path.join(CONTENT_DIR, `${lang}.json`);
    if (!fs.existsSync(p)) { console.log(`  [${lang}] no content file — skipped`); continue; }
    const doc = readJson(p);
    if (!doc || doc.__broken) { broken.push(`${lang}.json (${doc && doc.__broken})`); continue; }
    langsFound++;
    if (RESYNC_CHAT) await resyncChat(lang, doc);
    await seedLang(lang, doc);
    console.log(`  [${lang}] seeded`);
  }
  if (broken.length) console.log('  BROKEN FILES (fix + rerun):', broken.join('; '));
  console.log(`done: langs=${langsFound} inserted=${stats.inserted} skipped=${stats.skipped} refreshed=${stats.refreshed} cleaned=${stats.cleaned} seed_versions=${stats.versions}`);
}

/* Drop seed-generated chatbot rows whose question no longer exists in the
   content file (rephrased questions get new keys). Only touches rows the
   seeder owns: key ends with -<lang>, never identity/partner_handoff, and
   only for languages with a valid current file. Raj hasn't edited these. */
async function resyncChat(lang, doc) {
  const d = db();
  const want = new Set((doc.chatbot?.qa || [])
    .map(qa => slugify(qa.q).slice(0, 50) + '-' + lang));
  const { data: rows } = await d.from('chatbot_replies')
    .select('id,key').eq('lang', lang);
  for (const r of (rows || [])) {
    if (!r.key.endsWith('-' + lang)) continue;
    if (want.has(r.key)) continue;
    await d.from('versions').delete().eq('item_type', 'chatbot_replies').eq('item_id', String(r.id));
    await d.from('chatbot_replies').delete().eq('id', r.id);
    stats.cleaned++;
    console.log(`  [${lang}] resync: dropped superseded reply "${r.key}"`);
  }
}

main().catch(e => { console.error('SEED FAILED:', e.message); process.exit(1); });
