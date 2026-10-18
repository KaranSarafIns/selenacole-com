/* lib/validate.js — server-side form validation + spam protection.
   Every public POST endpoint runs its input through here:
   - honeypot field `hp` must be empty (bots fill it)
   - minimum fill time via `form_ts` (submitted < 3s after render = bot)
   - length caps, email shape, no control characters
   Returns { ok, errors[], clean{} } — never throws on bad input. */
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const MIN_FILL_MS = 3000;

function str(v, max) {
  let s = String(v === undefined || v === null ? '' : v);
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}

function checkBase(body, opts) {
  const errors = [];
  const b = body || {};
  if (String(b.hp || '').trim() !== '') errors.push('spam');
  const ts = Number(b.form_ts || 0);
  if (ts && Date.now() - ts < MIN_FILL_MS) errors.push('too_fast');
  return { errors, b };
}

function checkEnquiry(body) {
  const { errors, b } = checkBase(body);
  const clean = {
    name: str(b.name, 80),
    email: str(b.email, 120).toLowerCase(),
    company: str(b.company, 120),
    topic: str(b.topic, 120),
    message: str(b.message, 3000),
  };
  if (!clean.name) errors.push('name_required');
  if (!EMAIL_RE.test(clean.email)) errors.push('email_invalid');
  if (!clean.message || clean.message.length < 10) errors.push('message_too_short');
  return { ok: !errors.length, errors, clean };
}

function checkFanmail(body) {
  const { errors, b } = checkBase(body);
  const clean = {
    name: str(b.name, 80),
    email: str(b.email, 120).toLowerCase(),
    message: str(b.message, 2000),
  };
  if (!clean.name) errors.push('name_required');
  if (!EMAIL_RE.test(clean.email)) errors.push('email_invalid');
  if (!clean.message || clean.message.length < 2) errors.push('message_too_short');
  return { ok: !errors.length, errors, clean };
}

function checkSignup(body) {
  const { errors, b } = checkBase(body);
  const clean = {
    email: str(b.email, 120).toLowerCase(),
    lang: str(b.lang, 8).toLowerCase() || 'en',
  };
  if (!EMAIL_RE.test(clean.email)) errors.push('email_invalid');
  return { ok: !errors.length, errors, clean };
}

function checkChat(body) {
  const { errors, b } = checkBase(body);
  const clean = {
    message: str(b.message, 500),
    lang: str(b.lang, 8).toLowerCase() || 'en',
  };
  if (clean.message.length < 2) errors.push('message_too_short');
  return { ok: !errors.length, errors, clean };
}

module.exports = { checkEnquiry, checkFanmail, checkSignup, checkChat, str, EMAIL_RE };
