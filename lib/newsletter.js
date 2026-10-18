/* lib/newsletter.js — biweekly newsletter engine (Raj's locked 2026-10-18 decision).
   - draftNextIssue(db): creates ONE draft pre-filled from live site data if no
     open (draft/approved/queued) issue exists. Idempotent.
   - buildIssueHtml(issue, settings): renders the email HTML from sections.
   Sections (all Studio-editable, reorderable, show/hide):
     reels, bts, premieres, gallery, article, poll
   Nothing sends without Raj's one-click approval in the Studio. */
const B = require('./backend');

const LANGS = ['en','es','hi','gu','pa','fr','pt','de','it','ar','ja','ko','ru','zh'];

function sec(id, kind, title, extra) {
  return Object.assign({ id, kind, title, body: '', items: [], options: [], show: true, sort: 0 }, extra || {});
}

/* Pre-fill sections from live site data (English source rows). Every section
   stays hand-editable in the Studio after drafting. */
async function prefillSections(db) {
  const lang = 'en';
  const [reels, premieres, gallery, articles, journal] = await Promise.all([
    db.from('reels').select('item_key,title,caption,thumbnail_url,video_url')
      .eq('lang', lang).eq('show', true).order('sort', { ascending: true }).limit(3),
    db.from('reels').select('item_key,title,caption,thumbnail_url,video_url,premiere_at')
      .eq('lang', lang).eq('show', true)
      .gte('premiere_at', new Date().toISOString())
      .order('premiere_at', { ascending: true }).limit(3),
    db.from('gallery_items').select('item_key,caption,image_url')
      .eq('lang', lang).eq('show', true)
      .order('created_at', { ascending: false }).limit(4),
    db.from('bt_articles').select('article_key,title,excerpt,slug,cat_key')
      .eq('lang', lang).eq('published', true)
      .order('published_at', { ascending: false }).limit(1),
    db.from('journal_posts').select('title,excerpt')
      .eq('lang', lang).eq('show', true)
      .order('published_at', { ascending: false }).limit(2),
  ]);
  const R = (reels.data || []).map((r, i) => ({
    title: r.title || '', text: r.caption || '',
    image_url: B.absUrl(r.thumbnail_url), url: r.video_url || '/watch', sort: i, show: true,
  }));
  const P = (premieres.data || []).map((r, i) => ({
    title: r.title || '', text: r.caption || '',
    image_url: B.absUrl(r.thumbnail_url), url: r.video_url || '/watch',
    meta: r.premiere_at, sort: i, show: true,
  }));
  const G = (gallery.data || []).map((g, i) => ({
    title: g.caption || '', text: '',
    image_url: B.absUrl(g.image_url), url: '/gallery', sort: i, show: true,
  }));
  const A = (articles.data || []).map(a => ({
    title: a.title || '', text: a.excerpt || '', image_url: '',
    url: `/brutal-truth/${a.cat_key || 'vibes'}/${a.slug || a.article_key}`,
    sort: 0, show: true,
  }));
  const btsBody = (journal.data || [])
    .map(j => `• ${j.title || ''}${j.excerpt ? ' — ' + j.excerpt : ''}`).join('\n');

  return [
    sec('sec-reels', 'reels', 'The reels you loved most', { items: R, sort: 0, show: R.length > 0 }),
    sec('sec-bts', 'bts', 'Behind the scenes', { body: btsBody, sort: 1, show: btsBody.length > 0 }),
    sec('sec-premieres', 'premieres', 'See it here first', { items: P, sort: 2, show: P.length > 0 }),
    sec('sec-gallery', 'gallery', 'New shoot drop', { items: G, sort: 3, show: G.length > 0 }),
    sec('sec-article', 'article', 'brutal truth teaser', { items: A, sort: 4, show: A.length > 0 }),
    sec('sec-poll', 'poll', 'You decide', {
      body: 'Which outfit should I shoot in next?',
      options: ['Option A', 'Option B'], sort: 5, show: false,
    }),
  ];
}

async function nextIssueNo(db) {
  const { data } = await db.from('newsletter_issues')
    .select('issue_no').order('issue_no', { ascending: false }).limit(1);
  return ((data && data[0] && data[0].issue_no) || 0) + 1;
}

/* Create one draft if none is open. Returns { created, issue }.
   scheduled_for: last sent issue's slot + 14 days, else now + 14 days. */
async function draftNextIssue(db) {
  const { data: open } = await db.from('newsletter_issues')
    .select('id').in('status', ['draft', 'approved', 'queued']).limit(1);
  if (open && open.length) return { created: false, issue: null };
  const { data: last } = await db.from('newsletter_issues')
    .select('scheduled_for').eq('status', 'sent')
    .order('scheduled_for', { ascending: false }).limit(1);
  const base = (last && last[0] && last[0].scheduled_for)
    ? new Date(last[0].scheduled_for).getTime() : Date.now();
  const scheduled_for = new Date(base + 14 * 24 * 3600 * 1000).toISOString();
  const issue_no = await nextIssueNo(db);
  let sections = [];
  try { sections = await prefillSections(db); } catch (e) { sections = []; }
  const issue = {
    issue_no,
    subject: `Selena Cole — Issue #${issue_no}`,
    sections,
    status: 'draft',
    scheduled_for,
  };
  const { data, error } = await db.from('newsletter_issues').insert(issue).select('*').single();
  if (error) throw error;
  await B.snapshotVersion(db, 'newsletter_issue', data.id, null, 'newsletter_issues', 'id', data.id);
  return { created: true, issue: data };
}

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Render the email HTML for an issue (dark luxe, gold — matches the brand). */
function buildIssueHtml(issue, settings) {
  const site = (process.env.SITE_URL || 'https://selenacole.com').replace(/\/$/, '');
  const brand = (settings && settings.brand_name) || 'Selena Cole';
  const sections = (issue.sections || []).filter(s => s.show !== false)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  let blocks = '';
  for (const s of sections) {
    let inner = '';
    if (s.body) inner += `<p style="color:#e8dcc0;line-height:1.6;white-space:pre-wrap">${esc(s.body)}</p>`;
    for (const it of (s.items || []).filter(x => x.show !== false)) {
      inner += `<table role="presentation" width="100%" style="margin:12px 0"><tr>`
        + (it.image_url ? `<td width="120" valign="top"><img src="${esc(it.image_url)}" alt="${esc(it.title)}" width="110" style="border-radius:8px;display:block"></td>` : '')
        + `<td valign="top" style="padding-left:${it.image_url ? '12' : '0'}px">
             <div style="color:#f5ead0;font-weight:bold">${esc(it.title)}</div>`
        + (it.text ? `<div style="color:#cbbd93;font-size:13px;margin:4px 0">${esc(it.text)}</div>` : '')
        + (it.url ? `<a href="${esc(it.url)}" style="color:#d4af37;font-size:13px">View →</a>` : '')
        + `</td></tr></table>`;
    }
    if (s.kind === 'poll' && (s.options || []).length) {
      inner += `<p style="color:#e8dcc0">${(s.options || []).map((o, i) =>
        `<span style="display:inline-block;border:1px solid #d4af37;color:#d4af37;border-radius:999px;padding:6px 14px;margin:4px 6px 4px 0;font-size:13px">${esc(o)}</span>`).join('')}</p>`
        + `<p style="color:#9a8a5f;font-size:12px">Reply to this email with your pick — I read every one.</p>`;
    }
    blocks += `<div style="margin:0 0 28px"><h2 style="color:#d4af37;font-family:Georgia,serif;margin:0 0 10px;font-size:20px">${esc(s.title)}</h2>${inner}</div>`;
  }
  return `<!DOCTYPE html><html><body style="margin:0;background:#0f0c06">
    <div style="max-width:600px;margin:0 auto;background:#171208;padding:36px 28px;font-family:Georgia,serif">
      <div style="text-align:center;margin-bottom:24px">
        <div style="color:#d4af37;font-size:28px;letter-spacing:2px">${esc(brand)}</div>
        <div style="color:#9a8a5f;font-size:12px;letter-spacing:4px;margin-top:4px">NEWSLETTER · ISSUE #${issue.issue_no}</div>
      </div>
      ${blocks}
      <div style="border-top:1px solid #3a2f18;margin-top:28px;padding-top:16px;text-align:center">
        <div style="margin-bottom:12px"><a href="${site}" style="color:#d4af37;margin:0 8px;font-size:13px">Website</a>
        <a href="${site}/watch" style="color:#d4af37;margin:0 8px;font-size:13px">Watch</a>
        <a href="${site}/gallery" style="color:#d4af37;margin:0 8px;font-size:13px">Gallery</a></div>
        <a href="{{UNSUB_URL}}" style="color:#6f6247;font-size:11px">Unsubscribe</a>
      </div>
    </div></body></html>`;
}

module.exports = { prefillSections, draftNextIssue, nextIssueNo, buildIssueHtml, LANGS };
