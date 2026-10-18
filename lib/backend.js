/* Shared server helpers for /api/* (Vercel serverless, Node) — SelenaCole.com.
   Mirrors the proven katiesbeautysalon patterns:
   - All Supabase access uses the service_role key — it never leaves the server.
   - Every query is scoped to the site's schema via .schema() (SUPABASE_SCHEMA,
     default site_selenacole). PostgREST must expose the schema or calls 406.
   - Admin sessions are HMAC-signed tokens in an httpOnly cookie (sc_sess, 12h).
   - Version snapshots (STANDARDS.md 3.17): snapshotVersion() writes a versions
     row before every content/settings/newsletter edit; retention = seeded
     original + last 3 (pruned server-side, never a Studio button). */
const crypto = require('crypto');

const SCHEMA = process.env.SUPABASE_SCHEMA || 'site_selenacole';
const COOKIE = 'sc_sess';

let _supa = null, _supaStorage = null;
function _client() {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}
function supa() {
  if (_supa) return _supa;
  // NOTE: .schema() returns a PostgREST-only client (no .storage) — perfect
  // for table queries, useless for buckets. Storage gets its own client.
  _supa = _client().schema(SCHEMA);
  return _supa;
}
function supaStorage() {
  if (_supaStorage) return _supaStorage;
  _supaStorage = _client(); // buckets are project-global; no schema scoping
  return _supaStorage;
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 2e6) { req.destroy(); reject(new Error('too large')); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function sessionToken() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('missing SESSION_SECRET');
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function sessionValid(req) {
  try {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return false;
    const m = (req.headers.cookie || '').match(new RegExp(COOKIE + '=([^;]+)'));
    if (!m) return false;
    const parts = m[1].split('.');
    if (parts.length !== 2) return false;
    const [payload, sig] = parts;
    const want = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
  } catch (e) { return false; }
}

function setSessionCookie(res, tok) {
  res.setHeader('Set-Cookie', `${COOKIE}=${tok}; HttpOnly; Path=/; Max-Age=43200; SameSite=Lax; Secure`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure`);
}

/* ---- per-IP rate limiting (Supabase-backed so it holds across serverless instances) ---- */
function clientIp(req) {
  const f = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '';
  return String(f).split(',')[0].trim() || 'unknown';
}
async function _rlGet(db, rkey) {
  try {
    const { data } = await db.from('rate_limits').select('value').eq('key', rkey).maybeSingle();
    return data && data.value;
  } catch (e) { return null; }
}
async function rateLimitHit(kind, key, max, windowMs) {
  try {
    const rec = await _rlGet(supa(), `rl:${kind}:${key}`);
    return !!(rec && rec.reset > Date.now() && rec.count >= max);
  } catch (e) { return false; }
}
async function rateLimitAdd(kind, key, windowMs) {
  try {
    const db = supa(), rkey = `rl:${kind}:${key}`, now = Date.now();
    let rec = await _rlGet(db, rkey);
    if (!rec || typeof rec !== 'object' || !(rec.reset > now)) rec = { count: 0, reset: now + windowMs };
    rec.count += 1;
    await db.from('rate_limits').upsert({ key: rkey, value: rec }, { onConflict: 'key' });
  } catch (e) {}
}
async function clearRateLimit(kind, key) {
  try { await supa().from('rate_limits').delete().eq('key', `rl:${kind}:${key}`); } catch (e) {}
}

/* ---- insert that works whether the table's id is uuid-with-random-default,
   uuid without default, or an identity/serial column ---- */
async function dbInsert(db, table, row) {
  const attempt = await db.from(table).insert(row).select('id');
  if (!attempt.error) return attempt;
  const msg = String((attempt.error && attempt.error.message) || '').toLowerCase();
  if (row.id === undefined && /null value in column "id"|violates not-null constraint/.test(msg)) {
    return db.from(table).insert({ ...row, id: crypto.randomUUID() }).select('id');
  }
  return attempt;
}

function verifyPw(pw, salt, hash) {
  try {
    const h = crypto.scryptSync(String(pw), salt, 64).toString('hex');
    if (h.length !== hash.length) return false;
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch (e) { return false; }
}

function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return { salt, hash };
}

/* Image URLs must be absolute paths: relative URLs resolve against the
   requester's base and 404. Stored values may be relative; normalize on the
   way out. */
function absUrl(u) {
  u = String(u || '');
  if (!u) return u;
  if (u.charAt(0) === '/' || /^https?:\/\//i.test(u)) return u;
  return '/' + u;
}

/* ---- version snapshots (STANDARDS.md 3.17) ----
   Call BEFORE mutating a content/settings/newsletter row: stores the current
   DB state as a versions row, then prunes to (seeded original + last 3).
   itemId: the row's uuid string, or 'site_settings' for settings. */
async function snapshotVersion(db, itemType, itemId, lang, table, idCol, idVal) {
  try {
    const { data: cur, error } = await db.from(table).select('*').eq(idCol, idVal).maybeSingle();
    if (error || !cur) return;
    const row = { ...cur };
    delete row.created_at; delete row.updated_at;
    await db.from('versions').insert({
      item_type: itemType, item_id: String(itemId),
      lang: lang || cur.lang || null,
      data: row, seed_original: false,
    });
    // prune: keep the seeded original + newest 3 non-original snapshots
    const { data: vers } = await db.from('versions')
      .select('id,seed_original,created_at')
      .eq('item_type', itemType).eq('item_id', String(itemId))
      .order('created_at', { ascending: false });
    if (vers && vers.length) {
      const keep = new Set();
      let nonOrig = 0;
      for (const v of vers) {
        if (v.seed_original) { keep.add(v.id); continue; }
        if (nonOrig < 3) { keep.add(v.id); nonOrig++; }
      }
      const drop = vers.map(v => v.id).filter(id => !keep.has(id));
      if (drop.length) await db.from('versions').delete().in('id', drop);
    }
  } catch (e) { /* versioning must never block the save itself */ }
}

async function listVersions(db, itemType, itemId, lang) {
  let q = db.from('versions').select('id,item_type,item_id,lang,seed_original,created_at')
    .eq('item_type', itemType).eq('item_id', String(itemId))
    .order('created_at', { ascending: false }).limit(10);
  if (lang) q = q.eq('lang', lang);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/* Cron auth: shared secret, Bearer header or ?secret= (Vercel cron compatible). */
function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const h = String(req.headers.authorization || '');
  if (h === 'Bearer ' + secret) return true;
  try {
    const u = new URL(req.url, 'http://x');
    return u.searchParams.get('secret') === secret;
  } catch (e) { return false; }
}

module.exports = {
  supa, supaStorage, json, readBody, sessionToken, sessionValid, setSessionCookie,
  clearSessionCookie, verifyPw, hashPw, clientIp, rateLimitHit, rateLimitAdd,
  clearRateLimit, dbInsert, absUrl, snapshotVersion, listVersions,
  cronAuthorized, SCHEMA,
};
