/* GET /api/admin/versions?item_type=&item_id=[&lang=] — version timeline for one
   content item (session required). Returns newest-first: the seeded original
   plus the last 3 snapshots (STANDARDS.md 3.17). */
const B = require('../../lib/backend');
module.exports = async (req, res) => {
  if (req.method !== 'GET') return B.json(res, 405, { ok: false });
  if (!B.sessionValid(req)) return B.json(res, 401, { ok: false });
  try {
    let item_type = '', item_id = '', lang = '';
    try {
      const u = new URL(req.url, 'http://x');
      item_type = u.searchParams.get('item_type') || '';
      item_id = u.searchParams.get('item_id') || '';
      lang = u.searchParams.get('lang') || '';
    } catch (e) {}
    if (!item_type || !item_id) return B.json(res, 400, { ok: false });
    const vers = await B.listVersions(B.supa(), item_type, item_id, lang || null);
    return B.json(res, 200, { ok: true, versions: vers });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
