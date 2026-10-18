/* POST /api/track {type, path, lang} — lightweight anonymous analytics event.
   No PII is stored. Rate-limited per IP + globally. */
const B = require('../lib/backend');
const TYPES = ['visit', 'chat', 'signup', 'enquiry', 'fanmail', 'reel', 'gallery', 'journal', 'article', 'premiere'];
module.exports = async (req, res) => {
  if (req.method !== 'POST') return B.json(res, 405, { ok: false });
  try {
    const ip = B.clientIp(req);
    if (await B.rateLimitHit('track', ip, 60, 10 * 60 * 1000)
      || await B.rateLimitHit('track-global', 'all', 600, 10 * 60 * 1000)) {
      return B.json(res, 429, { ok: false, error: 'rate_limited' });
    }
    await B.rateLimitAdd('track', ip, 10 * 60 * 1000);
    await B.rateLimitAdd('track-global', 'all', 10 * 60 * 1000);
    const { type, path, lang } = await B.readBody(req);
    if (!TYPES.includes(type)) return B.json(res, 400, { ok: false });
    const { error } = await B.supa().from('analytics_events').insert({
      type,
      path: String(path || '/').slice(0, 200),
      lang: String(lang || '').slice(0, 8) || null,
      at: new Date().toISOString(),
    });
    if (error) throw error;
    return B.json(res, 200, { ok: true });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
