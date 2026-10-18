/* GET /api/unsubscribe?token= — one-click unsubscribe landing page. */
const B = require('../lib/backend');

function page(title, msg) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Selena Cole</title></head>
<body style="margin:0;background:#0f0c06;color:#f5ead0;font-family:Georgia,serif;
display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px">
<div style="max-width:480px;text-align:center;background:#171208;border:1px solid #3a2f18;
border-radius:16px;padding:40px 32px">
<div style="color:#d4af37;font-size:26px;letter-spacing:2px;margin-bottom:12px">SELENA COLE</div>
<h1 style="font-size:22px;margin:0 0 12px">${title}</h1>
<p style="color:#cbbd93;line-height:1.6">${msg}</p>
<a href="/" style="display:inline-block;margin-top:16px;color:#171208;background:#d4af37;
font-weight:bold;padding:12px 28px;border-radius:999px;text-decoration:none">Back to the site</a>
</div></body></html>`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return B.json(res, 405, { ok: false });
  try {
    let token = '';
    try { token = new URL(req.url, 'http://x').searchParams.get('token') || ''; } catch (e) {}
    if (token && token.length <= 128) {
      const db = B.supa();
      await db.from('newsletter_signups').update({ status: 'unsubscribed' }).eq('token', token);
    }
    res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(page('Unsubscribed',
      'You\'re off the list — no more emails. If this was a mistake, you can sign up again anytime.'));
  } catch (e) {
    res.statusCode = 500; res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(page('Oops', 'Something went wrong. Please try again later.'));
  }
};
