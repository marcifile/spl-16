import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db } from './lib/db.js';
import * as P from './lib/meteora.js';
import * as C from './lib/curve.js';
import { buildLaunchTx, confirmLaunch } from './lib/launch.js';
import { iconSvg, iconPng, glyphSvg } from './lib/icon.js';
import { putFile, putJson, assetsDir } from './lib/store.js';
import * as L from './lib/live.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
app.use('/a', express.static(assetsDir, { maxAge: '365d', immutable: true }));
const DRY = process.env.DRY_RUN === '1';
const now = () => Date.now();
const site = () => (process.env.SITE_URL || 'http://localhost:8792').replace(/\/$/, '');

const pub = c => c && ({ ...c, points: JSON.parse(c.points), hist: undefined });

// ---- read ----
app.get('/api/state', (req, res) => {
  const coins = db.prepare('select * from coins order by created_at desc limit 200').all().map(pub);
  const t = db.prepare('select count(*) coins, coalesce(sum(migrated),0) graduated, coalesce(sum(quote_reserve_sol),0) tvl, coalesce(sum(fees_sol),0) fees, coalesce(sum(volume_sol),0) volume, coalesce(sum(trades),0) trades from coins').get();
  res.json({ coins, totals: t, site: site(), x: process.env.X_URL || 'https://x.com/splsixteen', ca: process.env.PLATFORM_MINT || null, config: { startMcapSol: C.START_MCAP_SOL, maxMcapSol: C.MAX_MCAP_SOL, taxSeconds: C.TAX_SECONDS, maxTaxBps: C.MAX_FEE_BPS } });
});
app.get('/api/coin/:mint', (req, res) => {
  const c = db.prepare('select * from coins where mint=?').get(req.params.mint);
  if (!c) return res.status(404).json({ error: 'no such coin' });
  res.json({ coin: pub(c), hist: JSON.parse(c.hist || '[]'), quote: safeQuote(JSON.parse(c.points), c.tax_start_bps), trades: db.prepare('select * from trades where mint=? order by at desc limit 100').all(c.mint) });
});
app.get('/api/mine/:wallet', (req, res) => res.json({ coins: db.prepare('select * from coins where creator=? order by created_at desc').all(req.params.wallet).map(pub) }));
const liveCache = new Map();
app.get('/api/coin/:mint/live', async (req, res) => {
  const c = db.prepare('select * from coins where mint=?').get(req.params.mint); if (!c) return res.status(404).json({ error: 'no such coin' });
  if (!DRY && c.pool !== 'dry') { const hit = liveCache.get(c.mint); if (!hit || Date.now() - hit > 6000) { liveCache.set(c.mint, Date.now()); try { await L.refresh(c); } catch (e) { console.error('live', e.message); } } }
  const f = db.prepare('select * from coins where mint=?').get(c.mint);
  res.json({ coin: pub(f), hist: JSON.parse(f.hist || '[]'), trades: db.prepare('select * from trades where mint=? order by at desc limit 100').all(c.mint) });
});
app.get('/api/presets', (req, res) => res.json(Object.fromEntries(Object.keys(C.PRESETS).map(k => [k, C.presetPoints(k)]))));

// live quote for a drawing (real DBC math)
app.post('/api/quote', (req, res) => {
  try { res.json(C.quote({ points: req.body.points, taxStartBps: Number(req.body.taxStartBps) || 0 })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
function safeQuote(points, tax) { try { return C.quote({ points, taxStartBps: tax }); } catch { return null; } }

// icons
app.get('/icon/:mint.svg', (req, res) => {
  const c = db.prepare('select points from coins where mint=?').get(req.params.mint); if (!c) return res.status(404).end();
  res.type('image/svg+xml').set('cache-control', 'public, max-age=31536000, immutable').send(iconSvg(JSON.parse(c.points)));
});
app.get('/glyph/:mint.svg', (req, res) => {
  const c = db.prepare('select points from coins where mint=?').get(req.params.mint); if (!c) return res.status(404).end();
  res.type('image/svg+xml').set('cache-control', 'public, max-age=31536000, immutable').send(glyphSvg(JSON.parse(c.points), '#111114'));
});
app.post('/api/preview-icon', (req, res) => { try { res.type('image/svg+xml').send(iconSvg(req.body.points)); } catch (e) { res.status(400).json({ error: e.message }); } });

// ---- launch: 1) build unsigned tx(s) for the creator's wallet, 2) creator signs+sends in browser, 3) we confirm & record ----
app.post('/api/launch/prepare', async (req, res) => {
  try {
    const { creator, name, ticker, description = '', points, taxStartBps = 0, firstBuySol = 0, logo = null } = req.body;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(creator))) return res.status(400).json({ error: 'connect a wallet first' });
    const nm = String(name || '').trim().slice(0, 32), tk = String(ticker || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    if (nm.length < 1 || tk.length < 2) return res.status(400).json({ error: 'name and ticker (2–10 letters)' });
    const q = C.quote({ points, taxStartBps: Number(taxStartBps) || 0 }); // validates the curve
    const stamp = `${tk.toLowerCase()}-${crypto.randomBytes(3).toString('hex')}`;
    let imageUrl, logoUrl = null;
    const curvePng = await iconPng(points, 512);
    const curveUrl = curvePng ? await putFile(`${stamp}-curve.png`, curvePng, 'image/png') : await putFile(`${stamp}-curve.svg`, Buffer.from(iconSvg(points)), 'image/svg+xml');
    if (logo && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(logo)) {
      const buf = Buffer.from(logo.split(',')[1], 'base64'); if (buf.length > 2_000_000) return res.status(400).json({ error: 'logo must be under 2 MB' });
      let out = buf, type = 'image/png';
      try { const sharp = (await import('sharp')).default; out = await sharp(buf).resize(512, 512, { fit: 'cover' }).png().toBuffer(); } catch { type = logo.slice(5, logo.indexOf(';')); }
      logoUrl = await putFile(`${stamp}-logo.png`, out, type); imageUrl = logoUrl;
    } else imageUrl = curveUrl;
    const uri = await putJson(`${stamp}.json`, { name: nm, symbol: tk, description: description.slice(0, 300) || `${nm} — a hand-drawn ${q.shape} curve on spline (SPL-16).`, image: imageUrl, website: site(), createdOn: site(), attributes: [{ trait_type: 'standard', value: 'SPL-16' }, { trait_type: 'shape', value: q.shape }, { trait_type: 'points', value: 16 }, { trait_type: 'curve', value: points.map(v => Math.round(Number(v) * 1000) / 1000).join(',') }], properties: { curve_image: curveUrl } });
    if (DRY) {
      const mint = crypto.randomBytes(32).toString('hex').slice(0, 44), pool = 'dry';
      record({ mint, pool, config: 'dry', name: nm, ticker: tk, description, image: imageUrl, logo: logoUrl, uri, creator, points, taxStartBps, q, sig: 'dry' });
      return res.json({ dry: true, mint, pool });
    }
    const built = await buildLaunchTx({ creator, name: nm, symbol: tk, uri, points, taxStartBps: Number(taxStartBps) || 0, firstBuySol: Number(firstBuySol) || 0 });
    db.prepare('insert or replace into drafts (id, creator, points, tax_start_bps, name, ticker, created_at) values (?,?,?,?,?,?,?)').run(built.mint, creator, JSON.stringify(points), Number(taxStartBps) || 0, nm, tk, now());
    pending.set(built.mint, { ...built, name: nm, ticker: tk, description, image: imageUrl, logo: logoUrl, uri, creator, points, taxStartBps: Number(taxStartBps) || 0, q });
    res.json({ txs: built.txs, mint: built.mint, pool: built.pool, config: built.config, quote: q, image: imageUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
const pending = new Map();
app.post('/api/launch/confirm', async (req, res) => {
  try {
    const { mint, sig } = req.body; const p = pending.get(mint);
    if (!p) return res.status(404).json({ error: 'unknown launch' });
    const c = await confirmLaunch(sig);
    if (!c.confirmed) return res.status(409).json({ error: c.err ? 'transaction failed' : 'not confirmed yet', detail: c.err });
    record({ ...p, sig }); pending.delete(mint);
    res.json({ ok: true, mint, pool: p.pool });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
function record({ mint, pool, config, name, ticker, description, image, logo, uri, creator, points, taxStartBps, q, sig }) {
  db.prepare(`insert or ignore into coins (mint, pool, config, name, ticker, description, image, logo, metadata_uri, creator, points, shape, tax_start_bps, to_graduate_sol, start_mcap_sol, grad_mcap_sol, launch_sig, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(mint, pool, config, name, ticker, description || '', image, logo || null, uri, creator, JSON.stringify(points), q.shape, Number(taxStartBps) || 0, q.toGraduateSol, q.startMcapSol, q.gradMcapSol, sig, now());
}

// ---- live loop: every 30s refresh every pool that hasn't graduated (stats + new trades) ----
async function loop() {
  const live = db.prepare("select * from coins where migrated=0 and pool<>'dry' order by last_seen asc limit 60").all();
  for (const c of live) { try { await L.refresh(c); } catch (e) { console.error('refresh', c.mint, e.message); } }
}
if (!DRY) { setInterval(loop, 30_000); setTimeout(loop, 3_000); }

// pages
for (const p of ['/lab', '/draw', '/c/:m', '/standard', '/coins', '/mine']) app.get(p, (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

const port = Number(process.env.PORT || 8792);
app.listen(port, () => console.log(`spline on http://localhost:${port} · ${DRY ? 'DRY RUN' : 'live'} · rpc ${P.rpcState().using} · house ${process.env.HOUSE_WALLET ? 'set' : 'MISSING'}`));
