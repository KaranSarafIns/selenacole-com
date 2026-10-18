/* GET /api/presskit — one-page Partners PDF, regenerated from LIVE Studio data.
   Behind the `upgrade_presskit` toggle: off → 404. Never out of date, because
   every field is read from the database at request time. */
const B = require('../lib/backend');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return B.json(res, 405, { ok: false });
  try {
    const db = B.supa();
    const [tg, set, about, reels, gal, arts] = await Promise.all([
      db.from('toggles').select('enabled').eq('key', 'upgrade_presskit').maybeSingle(),
      db.from('site_settings').select('*').eq('id', 1).maybeSingle(),
      db.from('pages_content').select('title,subtitle,body').eq('page', 'about').eq('lang', 'en').eq('show', true).maybeSingle(),
      db.from('reels').select('id', { count: 'exact', head: true }).eq('lang', 'en').eq('show', true),
      db.from('gallery_items').select('id', { count: 'exact', head: true }).eq('lang', 'en').eq('show', true),
      db.from('bt_articles').select('id', { count: 'exact', head: true }).eq('lang', 'en').eq('published', true),
    ]);
    if (tg.data && tg.data.enabled === false) return B.json(res, 404, { ok: false, error: 'disabled' });

    const PDFDocument = require('pdfkit');
    const s = set.data || {};
    const brand = s.brand_name || 'Selena Cole';
    const socials = s.socials || {};
    const emails = s.emails || {};
    const bioBlocks = (about.data && about.data.body) || [];
    const bio = bioBlocks.map(b => (b && b.text) || '').filter(Boolean).join('\n\n').slice(0, 1200)
      || 'Selena Cole — creator, performer, and the flagship of Team Selena.';

    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const done = new Promise(resolve => doc.on('end', resolve));

    // header band
    doc.rect(0, 0, 595, 150).fill('#171208');
    doc.fillColor('#d4af37').fontSize(34).font('Helvetica-Bold')
      .text(brand.toUpperCase(), 56, 48, { characterSpacing: 3 });
    doc.fillColor('#9a8a5f').fontSize(11).font('Helvetica')
      .text('P R E S S   K I T', 56, 92);
    doc.fillColor('#6f6247').fontSize(9)
      .text('Generated live from SelenaCole.com Studio · ' + new Date().toISOString().slice(0, 10), 56, 112);

    let y = 190;
    doc.fillColor('#8a6d1c').fontSize(13).font('Helvetica-Bold').text('BIO', 56, y);
    y += 22;
    doc.fillColor('#222').fontSize(10.5).font('Helvetica').text(bio, 56, y, { width: 483, lineGap: 4 });
    y = doc.y + 26;

    doc.fillColor('#8a6d1c').fontSize(13).font('Helvetica-Bold').text('AT A GLANCE', 56, y);
    y += 22;
    const stats = [
      ['Reels live', String(reels.count || 0)],
      ['Gallery images', String(gal.count || 0)],
      ['Journal & articles', String(arts.count || 0)],
    ];
    for (const [k, v] of stats) {
      doc.fillColor('#222').fontSize(11).font('Helvetica-Bold').text(k, 56, y);
      doc.fillColor('#8a6d1c').font('Helvetica-Bold').text(v, 260, y);
      y += 20;
    }
    y += 12;

    doc.fillColor('#8a6d1c').fontSize(13).font('Helvetica-Bold').text('FOLLOW', 56, y);
    y += 22;
    doc.fillColor('#222').fontSize(10.5).font('Helvetica');
    const socialLines = Object.entries(socials).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    doc.text(socialLines.length ? socialLines.join('\n') : 'selenacole.com', 56, y, { width: 483, lineGap: 5 });
    y = doc.y + 26;

    doc.fillColor('#8a6d1c').fontSize(13).font('Helvetica-Bold').text('PARTNERSHIPS', 56, y);
    y += 22;
    doc.fillColor('#222').fontSize(10.5).font('Helvetica')
      .text(`Business enquiries: ${emails.partners || 'via the Partners page on selenacole.com'}\nGeneral contact: ${emails.fan || 'via the contact page'}`, 56, y, { width: 483, lineGap: 5 });

    doc.fillColor('#9a8a5f').fontSize(8)
      .text('© Selena Cole · selenacole.com', 56, 780, { align: 'center', width: 483 });

    doc.end();
    await done;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="selena-cole-press-kit.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(Buffer.concat(chunks));
  } catch (e) { return B.json(res, 500, { ok: false }); }
};
