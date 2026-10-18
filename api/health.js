/* GET /api/health — liveness + DB reachability (used by keepalive + monitors) */
const B = require('../lib/backend');
module.exports = async (req, res) => {
  if (req.method !== 'GET') return B.json(res, 405, { ok: false });
  const t0 = Date.now();
  try {
    await B.supa().from('site_settings').select('id').eq('id', 1).maybeSingle();
    return B.json(res, 200, { ok: true, schema: B.SCHEMA, db_ms: Date.now() - t0 });
  } catch (e) {
    return B.json(res, 500, { ok: false, db_ms: Date.now() - t0 });
  }
};
