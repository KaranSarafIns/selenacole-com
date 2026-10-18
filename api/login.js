/* POST /api/login {password} — server-side password check, sets httpOnly session cookie.
   The admin password is set by Raj himself via /api/admin/setup (first run);
   Nisha never invents or stores it. Failed attempts rate-limited per IP
   (5/15min) and globally (30/15min); success clears the counters. */
const B = require('../lib/backend');
const LOGIN_MAX = 5, LOGIN_WINDOW = 15 * 60 * 1000, LOGIN_GLOBAL_MAX = 30;
module.exports = async (req, res) => {
  if (req.method !== 'POST') return B.json(res, 405, { ok: false });
  try {
    const ip = B.clientIp(req);
    const limited = await B.rateLimitHit('login', ip, LOGIN_MAX, LOGIN_WINDOW)
      || await B.rateLimitHit('login-global', 'all', LOGIN_GLOBAL_MAX, LOGIN_WINDOW);
    if (limited) return B.json(res, 429, { ok: false, error: 'rate_limited' });
    const { password } = await B.readBody(req);
    const { data, error } = await B.supa().from('admin_auth').select('salt,hash').eq('id', 1).maybeSingle();
    if (error || !data || !data.salt || !data.hash) return B.json(res, 500, { ok: false });
    if (!B.verifyPw(password || '', data.salt, data.hash)) {
      await B.rateLimitAdd('login', ip, LOGIN_WINDOW);
      await B.rateLimitAdd('login-global', 'all', LOGIN_WINDOW);
      return B.json(res, 401, { ok: false });
    }
    await B.clearRateLimit('login', ip);
    await B.clearRateLimit('login-global', 'all');
    B.setSessionCookie(res, B.sessionToken());
    return B.json(res, 200, { ok: true });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
