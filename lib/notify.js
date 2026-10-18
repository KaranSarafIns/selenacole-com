/* lib/notify.js — owner email alerts + newsletter sending via Resend.
   Dependency-free HTTPS (mirrors the katies Twilio pattern — no npm mailer).
   NEVER throws: a form submission must succeed even if the email fails.
   NEVER logs email bodies or addresses — only ids/statuses.

   Env: RESEND_API_KEY, NOTIFY_FROM (e.g. "Selena Cole Studio <studio@selenacole.com>"),
        SITE_URL (default https://selenacole.com). */
const https = require('https');

function postJson(path, apiKey, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.resend.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 15000,
    }, res => {
      let chunks = '';
      res.on('data', c => { chunks += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function cfg() {
  return {
    key: process.env.RESEND_API_KEY || '',
    from: process.env.NOTIFY_FROM || 'Selena Cole Studio <studio@selenacole.com>',
    site: (process.env.SITE_URL || 'https://selenacole.com').replace(/\/$/, ''),
  };
}

async function sendOne({ to, subject, html, text, headers }) {
  const { key, from } = cfg();
  if (!key) return { sent: false, reason: 'no_email_config' };
  try {
    const r = await postJson('/emails', key, {
      from, to: [to], subject, html, text: text || undefined, headers: headers || undefined,
    });
    if (r.status >= 200 && r.status < 300) return { sent: true };
    return { sent: false, reason: 'resend_http_' + r.status };
  } catch (e) {
    return { sent: false, reason: 'error' };
  }
}

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Partner enquiry alert → Partners@ inbox (public business email from settings). */
async function notifyEnquiry(to, e) {
  try {
    if (!to) return { sent: false, reason: 'no_recipient' };
    const html = `<div style="font-family:Georgia,serif;max-width:600px;color:#222">
      <h2 style="color:#8a6d1c">New partner enquiry — SelenaCole.com</h2>
      <p><b>Name:</b> ${esc(e.name)}<br><b>Email:</b> ${esc(e.email)}
      <br><b>Company:</b> ${esc(e.company || '—')}<br><b>Topic:</b> ${esc(e.topic || '—')}</p>
      <p style="white-space:pre-wrap;background:#f7f2e4;padding:12px;border-radius:8px">${esc(e.message)}</p>
      <p style="color:#888;font-size:12px">Reply directly to the sender. Also logged in the Studio inbox.</p></div>`;
    return await sendOne({ to, subject: `Partner enquiry: ${e.name}`, html });
  } catch (_) { return { sent: false, reason: 'error' }; }
}

/* Fan message alert → Selena@ inbox. */
async function notifyFanMail(to, m) {
  try {
    if (!to) return { sent: false, reason: 'no_recipient' };
    const html = `<div style="font-family:Georgia,serif;max-width:600px;color:#222">
      <h2 style="color:#8a6d1c">New fan message — SelenaCole.com</h2>
      <p><b>From:</b> ${esc(m.name)} &lt;${esc(m.email)}&gt;</p>
      <p style="white-space:pre-wrap;background:#f7f2e4;padding:12px;border-radius:8px">${esc(m.message)}</p>
      <p style="color:#888;font-size:12px">Also logged in the Studio inbox.</p></div>`;
    return await sendOne({ to, subject: `Fan mail from ${m.name}`, html });
  } catch (_) { return { sent: false, reason: 'error' }; }
}

/* Double opt-in confirmation email for newsletter signups. */
async function sendConfirmationEmail(to, token, lang) {
  try {
    const { site } = cfg();
    const url = `${site}/api/confirm?token=${encodeURIComponent(token)}`;
    const html = `<div style="font-family:Georgia,serif;max-width:600px;color:#f5ead0;background:#171208;padding:32px;border-radius:12px">
      <h1 style="color:#d4af37;margin:0 0 8px">Selena Cole</h1>
      <p>One little tap and you're on the list — behind-the-scenes notes, premiere heads-ups and new shoots, every two weeks.</p>
      <p><a href="${url}" style="display:inline-block;background:#d4af37;color:#171208;font-weight:bold;padding:12px 28px;border-radius:999px;text-decoration:none">Confirm my email</a></p>
      <p style="color:#9a8a5f;font-size:12px">If that wasn't you, just ignore this — nothing was subscribed.</p></div>`;
    return await sendOne({ to, subject: 'Confirm your Selena Cole updates 💛', html });
  } catch (_) { return { sent: false, reason: 'error' }; }
}

/* Newsletter batch send via Resend /emails/batch (max 100 per call).
   recipients: [{ email, token }] — each gets a personal unsubscribe link.
   Returns { results: [{ email, sent, reason }] }. Retries are the caller's job. */
async function sendBatchNewsletter({ recipients, subject, html }) {
  const { key, from, site } = cfg();
  if (!key) return { results: recipients.map(r => ({ email: r.email, sent: false, reason: 'no_email_config' })) };
  const results = [];
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100);
    const payload = chunk.map(r => ({
      from,
      to: [r.email],
      subject,
      html: html.replace(/\{\{UNSUB_URL\}\}/g,
        `${site}/api/unsubscribe?token=${encodeURIComponent(r.token)}`),
      headers: { 'List-Unsubscribe': `<${site}/api/unsubscribe?token=${encodeURIComponent(r.token)}>` },
    }));
    try {
      const res = await postJson('/emails/batch', key, payload);
      if (res.status >= 200 && res.status < 300) {
        let ids = [];
        try { ids = JSON.parse(res.body).data || []; } catch (_) {}
        chunk.forEach((r, idx) => results.push({
          email: r.email, sent: !!(ids[idx] && ids[idx].id), reason: ids[idx] && ids[idx].id ? undefined : 'batch_no_id',
        }));
      } else {
        chunk.forEach(r => results.push({ email: r.email, sent: false, reason: 'resend_http_' + res.status }));
      }
    } catch (_) {
      chunk.forEach(r => results.push({ email: r.email, sent: false, reason: 'error' }));
    }
  }
  return { results };
}

module.exports = { notifyEnquiry, notifyFanMail, sendConfirmationEmail, sendBatchNewsletter, sendOne };
