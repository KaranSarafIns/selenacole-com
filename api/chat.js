/* POST /api/chat {message, lang} — "Selena's Concierge", her AI helper.
   STANDING RULE (Raj, locked 2026-10-18): the concierge NEVER pretends to BE
   Selena. (a) Identity questions ("are you really Selena?") get the honest
   answer — it's her AI-powered concierge helper, 24/7, not Selena herself.
   (b) Partner/business intent routes to the Partners enquiry form.
   (c) Fan questions get helpful answers in a warm helper voice — never
   first-person-as-Selena. All reply copy is Studio-editable per language. */
const B = require('../lib/backend');
const V = require('../lib/validate');

const FALLBACK_EN = "I'm Selena's Concierge — her helper, here 24/7. I can point you to her latest reels, shoots and journal notes… and if it's business, the Partners page is where the serious talk happens 💛";
const IDENTITY_RE = /(are you (really|actually)|is this (really|actually)) selena|are you (the real )?selena|is this (the real )?selena|r u selena|who are you|r u (a )?robot|are you (an? )?ai\b|artificial intelligence|human or (ai|robot)/i;
const PARTNER_RE = /(partner|business|collab|brand|sponsor|advertis|press|invest|book me|hire|management|agent)/i;

function scoreRow(row, msg) {
  let score = 0;
  const kw = String(row.keywords || '').toLowerCase().split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  for (const k of kw) {
    if (k.length >= 3 && msg.includes(k)) score += k.length >= 6 ? 3 : 2;
  }
  const q = String(row.question || '').toLowerCase();
  if (q) {
    const words = q.split(/[^a-z\u00e0-\u024f\u0370-\u03ff\u0400-\u04ff\u0900-\u097f\u4e00-\u9fff]+/).filter(w => w.length >= 4);
    for (const w of words) if (msg.includes(w)) score += 1;
  }
  return score;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return B.json(res, 405, { ok: false });
  try {
    const ip = B.clientIp(req);
    if (await B.rateLimitHit('chat', ip, 30, 10 * 60 * 1000)) {
      return B.json(res, 429, { ok: false, error: 'rate_limited' });
    }
    await B.rateLimitAdd('chat', ip, 10 * 60 * 1000);
    const body = await B.readBody(req);
    const v = V.checkChat(body);
    if (!v.ok) return B.json(res, 200, { ok: true, answer: FALLBACK_EN });
    const msg = v.clean.message.toLowerCase();
    const lang = v.clean.lang;
    const db = B.supa();

    // chatbot toggle off → polite closed state
    const { data: tg } = await db.from('toggles').select('enabled').eq('key', 'chatbot').maybeSingle();
    if (tg && tg.enabled === false) {
      return B.json(res, 200, { ok: true, answer: FALLBACK_EN, off: true });
    }

    // (a) identity: NEVER pretend to be Selena — honest concierge answer
    if (IDENTITY_RE.test(msg)) {
      const { data: ident } = await db.from('chatbot_replies')
        .select('answer').eq('key', 'identity').eq('lang', lang).eq('show', true).maybeSingle();
      const answer = (ident && ident.answer)
        || "I'm Selena's Concierge — her AI-powered helper, here 24/7 to answer questions about her reels, shoots and journal. I'm not Selena herself, but I'll do my best to help! 💛";
      return B.json(res, 200, { ok: true, answer });
    }

    // (b) partner/business intent → route to the enquiry form (never a bare email)
    if (PARTNER_RE.test(msg)) {
      const { data: handoff } = await db.from('chatbot_replies')
        .select('answer').eq('key', 'partner_handoff').eq('lang', lang).eq('show', true).maybeSingle();
      const answer = (handoff && handoff.answer)
        || 'Ooh, business talk — I like it. My team handles all of that on the Partners page: tell them what you have in mind and they\'ll get right back to you 💼';
      return B.json(res, 200, { ok: true, answer, route: 'partners' });
    }

    // knowledge match: requested lang first, English as fallback
    let rows = [];
    for (const l of [lang, 'en']) {
      const { data, error } = await db.from('chatbot_replies').select('*')
        .eq('lang', l).eq('show', true);
      if (!error && data && data.length) { rows = data; break; }
    }
    let best = null, bestScore = 0;
    for (const row of rows) {
      const s = scoreRow(row, msg);
      if (s > bestScore) { bestScore = s; best = row; }
    }
    if (best && bestScore >= 2 && best.answer) {
      return B.json(res, 200, { ok: true, answer: best.answer });
    }

    // friendly fallback (per-language when the Studio has set one)
    const { data: set } = await db.from('site_settings')
      .select('chatbot_fallback').eq('id', 1).maybeSingle();
    const fb = (set && set.chatbot_fallback && (set.chatbot_fallback[lang] || set.chatbot_fallback.en)) || FALLBACK_EN;
    return B.json(res, 200, { ok: true, answer: fb });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
