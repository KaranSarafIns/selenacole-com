/* GET /api/qrsheet — printable QR card PDF (upgrade #4).
   Behind the `upgrade_qrsheet` toggle: off → 404. QR points at SITE_URL;
   rendered in the launch design direction's gold-on-noir. */
const B = require('../lib/backend');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return B.json(res, 405, { ok: false });
  try {
    const db = B.supa();
    const [tg, set] = await Promise.all([
      db.from('toggles').select('enabled').eq('key', 'upgrade_qrsheet').maybeSingle(),
      db.from('site_settings').select('brand_name,socials').eq('id', 1).maybeSingle(),
    ]);
    if (tg.data && tg.data.enabled === false) return B.json(res, 404, { ok: false, error: 'disabled' });

    const QRCode = require('qrcode');
    const PDFDocument = require('pdfkit');
    const site = (process.env.SITE_URL || 'https://selenacole.com').replace(/\/$/, '');
    const brand = (set.data && set.data.brand_name) || 'Selena Cole';

    const qrPng = await QRCode.toBuffer(site, { width: 900, margin: 1, color: { dark: '#171208', light: '#fbf3df' } });

    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const done = new Promise(resolve => doc.on('end', resolve));

    doc.rect(0, 0, 595, 842).fill('#0f0c06');
    doc.fillColor('#d4af37').fontSize(40).font('Helvetica-Bold')
      .text(brand.toUpperCase(), 0, 120, { align: 'center', characterSpacing: 4 });
    doc.fillColor('#9a8a5f').fontSize(13).font('Helvetica')
      .text('S C A N   T O   V I S I T', 0, 172, { align: 'center', characterSpacing: 6 });

    doc.image(qrPng, (595 - 340) / 2, 240, { width: 340, height: 340 });

    doc.fillColor('#f5ead0').fontSize(16).font('Helvetica')
      .text(site.replace(/^https?:\/\//, ''), 0, 610, { align: 'center' });
    doc.fillColor('#6f6247').fontSize(10)
      .text('Reels · Gallery · Journal · Partners', 0, 640, { align: 'center' });
    doc.fillColor('#3a2f18').fontSize(9)
      .text('Print me for shoots & events', 0, 780, { align: 'center' });

    doc.end();
    await done;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="selena-cole-qr-sheet.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(Buffer.concat(chunks));
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
