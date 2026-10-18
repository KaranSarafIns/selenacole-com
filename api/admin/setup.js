/* POST /api/admin/setup {password} — first-run admin password creation.
   ONLY works when the admin_auth table is empty; afterwards 403 already_set.
   Raj sets his own password here — it is never invented or stored by anyone else. */
const B = require('../../lib/backend');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return B.json(res, 405, { ok: false });
  try {
    const ip = B.clientIp(req);
    if (await B.rateLimitHit('setup', ip, 5, 15 * 60 * 1000)) {
      return B.json(res, 429, { ok: false, error: 'rate_limited' });
    }
    await B.rateLimitAdd('setup', ip, 15 * 60 * 1000);
    const { password } = await B.readBody(req);
    const pw = String(password || '');
    if (pw.length < 8) return B.json(res, 400, { ok: false, error: 'too_short' });
    const db = B.supa();
    const { data: existing, error: selErr } = await db.from('admin_auth').select('id').limit(1);
    if (selErr) throw selErr;
    if (existing && existing.length) return B.json(res, 403, { ok: false, error: 'already_set' });
    const { salt, hash } = B.hashPw(pw);
    const { error: insErr } = await db.from('admin_auth').insert({ id: 1, salt, hash });
    if (insErr) throw insErr;
    return B.json(res, 200, { ok: true });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
