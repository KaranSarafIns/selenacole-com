/* POST /api/admin/password {current, next} — change the admin password (session required) */
const B = require('../../lib/backend');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return B.json(res, 405, { ok: false });
  if (!B.sessionValid(req)) return B.json(res, 401, { ok: false });
  try {
    const { current, next } = await B.readBody(req);
    const nextPw = String(next || '');
    if (nextPw.length < 8) return B.json(res, 400, { ok: false, error: 'too_short' });
    const db = B.supa();
    const { data, error } = await db.from('admin_auth').select('salt,hash').eq('id', 1).maybeSingle();
    if (error || !data) return B.json(res, 500, { ok: false });
    if (!B.verifyPw(current || '', data.salt, data.hash)) {
      return B.json(res, 401, { ok: false, error: 'bad_current' });
    }
    const { salt, hash } = B.hashPw(nextPw);
    const { error: upErr } = await db.from('admin_auth').update({ salt, hash }).eq('id', 1);
    if (upErr) throw upErr;
    return B.json(res, 200, { ok: true });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
