/* POST /api/signup {email, lang} — newsletter signup (double opt-in).
   Stored as 'pending' in the Studio table; confirmation email sent with a
   token link. The form shows its confirmation state from the {ok:true} reply
   plus a "check your inbox" note. Re-signup of a pending address re-sends
   the confirmation; confirmed addresses are idempotent. */
const crypto = require('crypto');
const B = require('../lib/backend');
const V = require('../lib/validate');
const { sendConfirmationEmail } = require('../lib/notify');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return B.json(res, 405, { ok: false });
  try {
    const ip = B.clientIp(req);
    if (await B.rateLimitHit('signup', ip, 10, 60 * 60 * 1000)) {
      return B.json(res, 429, { ok: false, error: 'rate_limited' });
    }
    const body = await B.readBody(req);
    const v = V.checkSignup(body);
    if (!v.ok) {
      if (v.errors.includes('spam') || v.errors.includes('too_fast')) {
        await B.rateLimitAdd('signup', ip, 60 * 60 * 1000);
        return B.json(res, 200, { ok: true });
      }
      return B.json(res, 400, { ok: false, errors: v.errors });
    }
    await B.rateLimitAdd('signup', ip, 60 * 60 * 1000);
    const db = B.supa();
    const { data: existing } = await db.from('newsletter_signups')
      .select('id,status,token').eq('email', v.clean.email).maybeSingle();
    let token = existing && existing.token;
    if (!existing) {
      token = crypto.randomBytes(24).toString('hex');
      const { error } = await db.from('newsletter_signups').insert({
        email: v.clean.email, lang: v.clean.lang, status: 'pending', token,
      });
      if (error) throw error;
    } else if (existing.status === 'confirmed') {
      return B.json(res, 200, { ok: true, already: true });
    } else if (existing.status === 'unsubscribed') {
      token = crypto.randomBytes(24).toString('hex');
      const { error } = await db.from('newsletter_signups')
        .update({ status: 'pending', token, confirmed_at: null }).eq('id', existing.id);
      if (error) throw error;
    }
    await sendConfirmationEmail(v.clean.email, token, v.clean.lang);
    return B.json(res, 200, { ok: true });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
