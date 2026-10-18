/* POST /api/fanmail — fan contact form → Selena@.
   Kept clearly separate from the partner/business form. Same protections. */
const B = require('../lib/backend');
const V = require('../lib/validate');
const { notifyFanMail } = require('../lib/notify');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return B.json(res, 405, { ok: false });
  try {
    const ip = B.clientIp(req);
    if (await B.rateLimitHit('fanmail', ip, 5, 60 * 60 * 1000)) {
      return B.json(res, 429, { ok: false, error: 'rate_limited' });
    }
    const body = await B.readBody(req);
    const v = V.checkFanmail(body);
    if (!v.ok) {
      if (v.errors.includes('spam') || v.errors.includes('too_fast')) {
        await B.rateLimitAdd('fanmail', ip, 60 * 60 * 1000);
        return B.json(res, 200, { ok: true });
      }
      return B.json(res, 400, { ok: false, errors: v.errors });
    }
    await B.rateLimitAdd('fanmail', ip, 60 * 60 * 1000);
    const db = B.supa();
    const ins = await B.dbInsert(db, 'fan_messages', { ...v.clean, status: 'new', notify_status: 'pending' });
    if (ins.error) throw ins.error;
    const { data: set } = await db.from('site_settings').select('emails').eq('id', 1).maybeSingle();
    const to = (set && set.emails && set.emails.fan) || process.env.FAN_EMAIL || null;
    const n = await notifyFanMail(to, v.clean);
    await db.from('fan_messages').update({ notify_status: n.sent ? 'sent' : 'failed' }).eq('id', ins.data[0].id);
    return B.json(res, 200, { ok: true });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
