/* POST /api/contact — the /contact page's two doors (fan + business) in one endpoint.
   Routes on the hidden `audience` field: 'business' → partner enquiry inbox
   (Partners@), anything else → fan inbox (Selena@). The two inboxes never mix:
   separate tables, separate validators, separate notify paths, separate rate
   limit buckets. Same spam protections as the dedicated endpoints. */
const B = require('../lib/backend');
const V = require('../lib/validate');
const { notifyFanMail, notifyEnquiry } = require('../lib/notify');

async function handleFan(req, res, ip) {
  if (await B.rateLimitHit('contact_fan', ip, 5, 60 * 60 * 1000)) {
    return B.json(res, 429, { ok: false, error: 'rate_limited' });
  }
  const body = await B.readBody(req);
  const v = V.checkFanmail(body);
  if (!v.ok) {
    if (v.errors.includes('spam') || v.errors.includes('too_fast')) {
      await B.rateLimitAdd('contact_fan', ip, 60 * 60 * 1000);
      return B.json(res, 200, { ok: true });
    }
    return B.json(res, 400, { ok: false, errors: v.errors });
  }
  await B.rateLimitAdd('contact_fan', ip, 60 * 60 * 1000);
  const db = B.supa();
  const ins = await B.dbInsert(db, 'fan_messages', { ...v.clean, status: 'new', notify_status: 'pending' });
  if (ins.error) throw ins.error;
  const { data: set } = await db.from('site_settings').select('emails').eq('id', 1).maybeSingle();
  const to = (set && set.emails && set.emails.fan) || process.env.FAN_EMAIL || null;
  const n = await notifyFanMail(to, v.clean);
  await db.from('fan_messages').update({ notify_status: n.sent ? 'sent' : 'failed' }).eq('id', ins.data[0].id);
  return B.json(res, 200, { ok: true });
}

async function handleBusiness(req, res, ip) {
  if (await B.rateLimitHit('contact_business', ip, 5, 60 * 60 * 1000)) {
    return B.json(res, 429, { ok: false, error: 'rate_limited' });
  }
  const body = await B.readBody(req);
  const v = V.checkEnquiry(body);
  if (!v.ok) {
    if (v.errors.includes('spam') || v.errors.includes('too_fast')) {
      await B.rateLimitAdd('contact_business', ip, 60 * 60 * 1000);
      return B.json(res, 200, { ok: true }); // pretend success to bots
    }
    return B.json(res, 400, { ok: false, errors: v.errors });
  }
  await B.rateLimitAdd('contact_business', ip, 60 * 60 * 1000);
  const db = B.supa();
  const ins = await B.dbInsert(db, 'enquiries', { ...v.clean, status: 'new', notify_status: 'pending' });
  if (ins.error) throw ins.error;
  const { data: set } = await db.from('site_settings').select('emails').eq('id', 1).maybeSingle();
  const to = (set && set.emails && set.emails.partners) || process.env.PARTNERS_EMAIL || null;
  const n = await notifyEnquiry(to, v.clean);
  await db.from('enquiries').update({ notify_status: n.sent ? 'sent' : 'failed' }).eq('id', ins.data[0].id);
  return B.json(res, 200, { ok: true });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return B.json(res, 405, { ok: false });
  try {
    const ip = B.clientIp(req);
    /* Peek at the audience field: read the body ONCE here and stash it so the
       downstream handler doesn't re-read a consumed stream. */
    const body = await B.readBody(req).catch(() => ({}));
    const audience = (body && body.audience) || 'fan';
    const origRead = B.readBody;
    B.readBody = async () => body;
    try {
      const fakeReq = Object.assign(Object.create(Object.getPrototypeOf(req)), req);
      if (audience === 'business') return await handleBusiness(fakeReq, res, ip);
      return await handleFan(fakeReq, res, ip);
    } finally {
      B.readBody = origRead;
    }
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
