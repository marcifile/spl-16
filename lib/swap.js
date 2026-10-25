// Buy/sell on a coin's DBC pool. The server builds an unsigned swap; the trader's wallet signs and sends it.
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import * as P from './meteora.js';

export async function quoteAndBuild({ pool, wallet, side, amount, slippageBps = 300 }) {
  const client = P.dbc(); const poolPk = new PublicKey(pool); const owner = new PublicKey(wallet);
  const v = await client.state.getPool(poolPk); if (!v) throw new Error('pool not found');
  const ps = v.poolState || v; if (Number(ps.isMigrated || 0) > 0) throw new Error('this coin has graduated — trade it on Jupiter');
  const cfg = await client.state.getPoolConfig(ps.config);
  const sell = side === 'sell'; const amt = Number(amount); if (!(amt > 0)) throw new Error('enter an amount');
  const bal = await balances({ mint: ps.baseMint.toBase58(), wallet });
  if (sell && bal.tokens <= 0) throw new Error("You don't hold any of this coin.");
  if (sell && amt > bal.tokens + 1e-6) throw new Error(`You only hold ${bal.tokens.toLocaleString()} tokens.`);
  if (!sell && bal.sol <= 0) throw new Error("You don't have any SOL in this wallet.");
  if (!sell && bal.sol < amt + 0.003) throw new Error(`Not enough SOL — you have ${bal.sol.toFixed(4)} SOL (keep ~0.003 for fees).`);
  const amountIn = new BN(Math.floor(amt * (sell ? 1e6 : 1e9)).toString());
  let q; try { q = client.pool.swapQuote({ virtualPool: v, config: cfg, swapBaseForQuote: sell, amountIn, slippageBps, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint: new BN(Math.floor(Date.now() / 1000)) }); } catch (e) { throw new Error(/insufficient/i.test(e.message) ? (sell ? 'not enough on the curve to sell that much' : 'that buy is bigger than what is left on the curve') : e.message); }
  const tx = await client.pool.swap({ owner, pool: poolPk, amountIn, minimumAmountOut: q.minimumAmountOut, swapBaseForQuote: sell, referralTokenAccount: null });
  tx.feePayer = owner; tx.recentBlockhash = (await P.connection().getLatestBlockhash()).blockhash;
  const out = Number((q.outputAmount ?? q.minimumAmountOut).toString()) / (sell ? 1e9 : 1e6);
  const min = Number(q.minimumAmountOut.toString()) / (sell ? 1e9 : 1e6);
  return { tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), out, min };
}

export async function balances({ mint, wallet }) {
  const c = P.connection(); const owner = new PublicKey(wallet);
  const [lam, accts] = await Promise.all([c.getBalance(owner), c.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) })]);
  const tokens = accts.value.reduce((a, x) => a + Number(x.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
  return { sol: lam / 1e9, tokens };
}
