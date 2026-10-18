/* POST /api/admin/upload {filename, contentBase64, alt} — image upload (session required).
   Auto-resizes with sharp into two renditions, both WebP:
     web   — max 1600px wide (hero, gallery, covers)
     phone — max 800px wide  (mobile, thumbnails)
   Stored in the shared 'gallery' bucket under selena/. Alt text is REQUIRED
   (STANDARDS.md imagery rule + the accessibility widget relies on it).
   Returns { ok, url, url_phone, alt }. No broken-image states: the upload
   either fully succeeds or 4xx/5xx — the Studio never stores a dead URL. */
const crypto = require('crypto');
const B = require('../../lib/backend');

const MAX_BYTES = 8 * 1024 * 1024;
const MIME_IN = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return B.json(res, 405, { ok: false });
  if (!B.sessionValid(req)) return B.json(res, 401, { ok: false });
  try {
    const { filename, contentBase64, alt } = await B.readBody(req);
    const ext = String(filename || '').split('.').pop().toLowerCase();
    if (!MIME_IN[ext]) return B.json(res, 400, { ok: false, error: 'bad_type' });
    const altText = String(alt || '').trim().slice(0, 200);
    if (!altText) return B.json(res, 400, { ok: false, error: 'alt_required' });
    const buf = Buffer.from(String(contentBase64 || ''), 'base64');
    if (!buf.length || buf.length > MAX_BYTES) return B.json(res, 400, { ok: false, error: 'bad_size' });

    const sharp = require('sharp');
    const base = `selena/${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const webBuf = await sharp(buf).rotate().resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer();
    const phoneBuf = await sharp(buf).rotate().resize({ width: 800, withoutEnlargement: true })
      .webp({ quality: 76 }).toBuffer();

    const db = B.supaStorage();
    const webPath = `${base}-web.webp`, phonePath = `${base}-phone.webp`;
    const up1 = await db.storage.from('gallery').upload(webPath, webBuf, { contentType: 'image/webp', upsert: false });
    if (up1.error) throw up1.error;
    const up2 = await db.storage.from('gallery').upload(phonePath, phoneBuf, { contentType: 'image/webp', upsert: false });
    if (up2.error) throw up2.error;
    const u1 = db.storage.from('gallery').getPublicUrl(webPath);
    const u2 = db.storage.from('gallery').getPublicUrl(phonePath);
    if (!u1.data || !u1.data.publicUrl || !u2.data || !u2.data.publicUrl) throw new Error('no_url');
    return B.json(res, 200, { ok: true, url: u1.data.publicUrl, url_phone: u2.data.publicUrl, alt: altText });
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
