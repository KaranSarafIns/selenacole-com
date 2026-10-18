/* GET /api/admin/data — everything the Studio needs (session required):
   all content tables (incl. hidden rows), inboxes, newsletter issues + sends,
   toggles, settings, and the analytics dashboard aggregates. */
const B = require('../../lib/backend');

const dayOf = iso => { try { return new Date(iso).toISOString().slice(0, 10); } catch (e) { return '?'; } };

module.exports = async (req, res) => {
  if (!B.sessionValid(req)) return B.json(res, 401, { ok: false });
  if (req.method !== 'GET') return B.json(res, 405, { ok: false });
  try {
    const db = B.supa();
    const [pages, reels, sets, items, journal, cats, arts, chat, faqs,
           enq, fan, signups, issues, sends, tg, set, ev] = await Promise.all([
      db.from('pages_content').select('*').order('page').order('lang'),
      db.from('reels').select('*').order('sort'),
      db.from('gallery_sets').select('*').order('sort'),
      db.from('gallery_items').select('*').order('set_key').order('sort'),
      db.from('journal_posts').select('*').order('published_at', { ascending: false }).limit(200),
      db.from('bt_categories').select('*').order('sort'),
      db.from('bt_articles').select('*').order('published_at', { ascending: false }).limit(200),
      db.from('chatbot_replies').select('*').order('key').order('lang'),
      db.from('faqs').select('*').order('lang').order('sort'),
      db.from('enquiries').select('*').order('created_at', { ascending: false }).limit(500),
      db.from('fan_messages').select('*').order('created_at', { ascending: false }).limit(500),
      db.from('newsletter_signups').select('*').order('created_at', { ascending: false }).limit(2000),
      db.from('newsletter_issues').select('*').order('issue_no', { ascending: false }).limit(60),
      db.from('newsletter_sends').select('issue_id,status').limit(5000),
      db.from('toggles').select('*').order('grp').order('key'),
      db.from('site_settings').select('*').eq('id', 1).maybeSingle(),
      db.from('analytics_events').select('type,path,lang,at').order('at', { ascending: false }).limit(10000),
    ]);
    const all = [pages, reels, sets, items, journal, cats, arts, chat, faqs, enq, fan, signups, issues, sends, tg, set, ev];
    const errs = all.map(r => r && r.error).filter(Boolean);
    if (errs.length) throw new Error('db');

    // analytics dashboard aggregates
    const visitsByDay = {}, byType = {}, byPath = {}, byLang = {};
    let visits = 0;
    for (const e of (ev.data || [])) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      if (e.type === 'visit') {
        visits++;
        const d = dayOf(e.at); visitsByDay[d] = (visitsByDay[d] || 0) + 1;
      }
      const p = (e.path || '/').split('?')[0].slice(0, 60);
      byPath[p] = (byPath[p] || 0) + 1;
      if (e.lang) byLang[e.lang] = (byLang[e.lang] || 0) + 1;
    }
    const topPaths = Object.entries(byPath).sort((a, b) => b[1] - a[1]).slice(0, 15);

    const unreadEnq = (enq.data || []).filter(x => x.status === 'new').length;
    const unreadFan = (fan.data || []).filter(x => x.status === 'new').length;
    const confirmedSubs = (signups.data || []).filter(x => x.status === 'confirmed').length;

    const sendsByIssue = {};
    for (const s of (sends.data || [])) {
      const k = s.issue_id;
      sendsByIssue[k] = sendsByIssue[k] || { sent: 0, failed: 0, pending: 0 };
      if (s.status === 'sent') sendsByIssue[k].sent++;
      else if (s.status === 'failed') sendsByIssue[k].failed++;
      else sendsByIssue[k].pending++;
    }

    return B.json(res, 200, {
      ok: true,
      pages_content: pages.data || [],
      reels: reels.data || [],
      gallery_sets: sets.data || [],
      gallery_items: items.data || [],
      journal_posts: journal.data || [],
      bt_categories: cats.data || [],
      bt_articles: arts.data || [],
      chatbot_replies: chat.data || [],
      faqs: faqs.data || [],
      enquiries: enq.data || [],
      fan_messages: fan.data || [],
      newsletter_signups: signups.data || [],
      newsletter_issues: issues.data || [],
      newsletter_sends_by_issue: sendsByIssue,
      toggles: tg.data || [],
      settings: set.data || {},
      unread: { enquiries: unreadEnq, fan: unreadFan, signups: confirmedSubs },
      analytics: { visits, visitsByDay, byType, byLang, topPaths },
    });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
