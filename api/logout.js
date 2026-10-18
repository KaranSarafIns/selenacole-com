/* POST /api/logout — clears the admin session cookie */
const B = require('../lib/backend');
module.exports = async (req, res) => {
  B.clearSessionCookie(res);
  return B.json(res, 200, { ok: true });
};
