/* POST /api/enquiry — partner enquiry form → Partners@.
   Server-side validation + honeypot + rate limit. Stored in the Studio inbox
   AND emailed to the public Partners@ address. Never a form that goes nowhere. */
const B = require('../lib/backend');
const V = require('../lib/validate');
const { notifyEnquiry } = require('../lib/notify');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return B.json(res, 405, { ok: false });
  try {
    const ip = B.clientIp(req);
    if (await B.rateLimitHit('enquiry', ip, 5, 60 * 60 * 1000)) {
      return B.json(res, 429, { ok: false, error: 'rate_limited' });
    }
    const body = await B.readBody(req);
    const v = V.checkEnquiry(body);
    if (!v.ok) {
      if (v.errors.includes('spam') || v.errors.includes('too_fast')) {
        await B.rateLimitAdd('enquiry', ip, 60 * 60 * 1000);
        return B.json(res, 200, { ok: true }); // pretend success to bots
      }
      return B.json(res, 400, { ok: false, errors: v.errors });
    }
    await B.rateLimitAdd('enquiry', ip, 60 * 60 * 1000);
    const db = B.supa();
    const ins = await B.dbInsert(db, 'enquiries', { ...v.clean, status: 'new', notify_status: 'pending' });
    if (ins.error) throw ins.error;
    const { data: set } = await db.from('site_settings').select('emails').eq('id', 1).maybeSingle();
    const to = (set && set.emails && set.emails.partners) || process.env.PARTNERS_EMAIL || null;
    const n = await notifyEnquiry(to, v.clean);
    await db.from('enquiries').update({ notify_status: n.sent ? 'sent' : 'failed' }).eq('id', ins.data[0].id);
    return B.json(res, 200, { ok: true });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
