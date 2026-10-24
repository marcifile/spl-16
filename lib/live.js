// Live pool reads + trade history. Trades are derived from token-balance deltas in each pool transaction,
// so they don't depend on any indexer's parser (DBC v1 transactions aren't understood by web3.js's parser).
import { PublicKey } from '@solana/web3.js';
import * as P from './meteora.js';
import { db } from './db.js';

db.exec(`create table if not exists trades (
  sig text primary key, mint text not null, at integer not null, side text not null,
  sol real not null, tokens real not null, wallet text not null, price real
);
create index if not exists trades_mint on trades(mint, at desc);`);
try { db.exec('alter table coins add column sold_pct real not null default 0'); } catch {}
try { db.exec('alter table coins add column last_sig text'); } catch {}
try { db.exec('alter table coins add column volume_sol real not null default 0'); } catch {}
try { db.exec('alter table coins add column trades integer not null default 0'); } catch {}

const cfgCache = new Map();
async function poolConfig(config) {
  if (!cfgCache.has(config)) cfgCache.set(config, await P.dbc().state.getPoolConfig(new PublicKey(config)));
  return cfgCache.get(config);
}

async function rpc(method, params) {
  const r = await fetch(P.rpcUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
}

// One fresh read of a pool: price, supply sold on the curve, SOL in, unclaimed fees.
export async function readPool(c) {
  const v = await P.dbc().state.getPool(new PublicKey(c.pool)); if (!v) return null;
  const ps = v.poolState || v; const cfg = await poolConfig(c.config);
  const sqrt = BigInt(ps.sqrtPrice.toString());
  const price = Number((sqrt * sqrt) >> 64n) / 2 ** 64 * 1e-3;                       // SOL per token
  const total = Number(cfg.preMigrationTokenSupply.toString()), curve = Number(cfg.swapBaseAmount.toString());
  const sold = Math.max(0, total - Number(ps.baseReserve.toString()));
  const lam = k => Number(ps[k].toString()) / 1e9;
  const thresh = Number(cfg.migrationQuoteThreshold.toString()) / 1e9;
  const reserve = Number(ps.quoteReserve.toString()) / 1e9;
  return {
    price, mcapSol: price * 1e9, soldPct: Math.min(1, sold / curve), reserveSol: reserve, progress: Math.min(1, reserve / thresh),
    migrated: Number(ps.isMigrated || 0) > 0, feesSol: lam('creatorQuoteFee') + lam('partnerQuoteFee') + lam('protocolQuoteFee'),
    creatorFeesSol: lam('creatorQuoteFee'), at: Date.now(),
  };
}

// Pull any new pool transactions and turn them into trades.
export async function syncTrades(c) {
  const v = await P.dbc().state.getPool(new PublicKey(c.pool)); const ps = v.poolState || v;
  const quoteVault = ps.quoteVault.toBase58(), mint = c.mint;
  const opts = { limit: 100 }; if (c.last_sig) opts.until = c.last_sig;
  const sigs = await rpc('getSignaturesForAddress', [c.pool, opts]);
  if (!sigs.length) return 0;
  const ins = db.prepare('insert or ignore into trades (sig, mint, at, side, sol, tokens, wallet, price) values (?,?,?,?,?,?,?,?)');
  let n = 0;
  for (const s of sigs.slice().reverse()) {
    if (s.err) continue;
    const tx = await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]).catch(() => null);
    if (!tx || tx.meta?.err) continue;
    const keys = tx.transaction.message.accountKeys.map(k => (typeof k === 'string' ? k : k.pubkey));
    const signer = keys[0];
    const bal = (arr, f) => (arr || []).filter(f).reduce((a, b) => a + Number(b.uiTokenAmount.uiAmount || 0), 0);
    const pre = tx.meta.preTokenBalances, post = tx.meta.postTokenBalances;
    const isTrader = b => b.mint === mint && b.owner === signer;
    const dTok = bal(post, isTrader) - bal(pre, isTrader);
    const vaultIdx = keys.indexOf(quoteVault);
    const isVault = b => b.accountIndex === vaultIdx;
    const dSol = bal(post, isVault) - bal(pre, isVault);
    if (!dTok || !dSol) continue;                       // not a swap (e.g. config/pool creation, claims)
    const side = dTok > 0 ? 'buy' : 'sell';
    const sol = Math.abs(dSol), tokens = Math.abs(dTok);
    ins.run(s.signature, mint, (s.blockTime || Math.floor(Date.now() / 1000)) * 1000, side, sol, tokens, signer, sol / tokens); n++;
  }
  const agg = db.prepare("select count(*) n, coalesce(sum(sol),0) v from trades where mint=?").get(mint);
  db.prepare('update coins set last_sig=?, trades=?, volume_sol=? where mint=?').run(sigs[0].signature, agg.n, agg.v, mint);
  return n;
}

export async function refresh(c) {
  const s = await readPool(c); if (!s) return null;
  const hist = JSON.parse(c.hist || '[]'); const last = hist[hist.length - 1];
  if (!last || Date.now() - last[0] > 20_000 || Math.abs(last[2] - s.price) > 1e-15) { hist.push([s.at, Math.round(s.reserveSol * 1e6) / 1e6, s.price, Math.round(s.soldPct * 1e5) / 1e5]); while (hist.length > 1500) hist.shift(); }
  db.prepare('update coins set progress=?, quote_reserve_sol=?, price_sol=?, migrated=?, fees_sol=?, sold_pct=?, hist=?, last_seen=? where mint=?')
    .run(s.progress, s.reserveSol, s.price, s.migrated ? 1 : 0, s.feesSol, s.soldPct, JSON.stringify(hist), s.at, c.mint);
  try { await syncTrades({ ...c, last_sig: db.prepare('select last_sig from coins where mint=?').get(c.mint)?.last_sig }); } catch (e) { console.error('trades', c.mint, e.message); }
  return s;
}
