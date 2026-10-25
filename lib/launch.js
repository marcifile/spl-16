// Build the launch transaction for a drawing: one tx that creates the per-coin config AND the pool.
// The creator's wallet signs it in the browser; we never hold their key. spline is the partner on every config
// (feeClaimer = house), the creator is the pool creator.
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';
import { createRequire } from 'node:module';
import * as P from './meteora.js';
import { configFor } from './curve.js';
const M = createRequire(import.meta.url)('@meteora-ag/dynamic-bonding-curve-sdk');
const SOL = new PublicKey('So11111111111111111111111111111111111111112');

export async function buildLaunchTx({ creator, name, symbol, uri, points, taxStartBps = 0, tax = {}, opts = {}, firstBuySol = 0, baseMint = Keypair.generate() }) {
  const house = P.houseWallet();
  const creatorPk = new PublicKey(creator);
  const { cfg } = configFor({ points, taxStartBps, tax, opts });
  const config = Keypair.generate();
  const common = { ...cfg, config: config.publicKey, feeClaimer: house, leftoverReceiver: house, quoteMint: SOL, payer: creatorPk, preCreatePoolParam: { name, symbol, uri, poolCreator: creatorPk, baseMint: baseMint.publicKey } };
  let txs;
  if (firstBuySol > 0) {
    const r = await P.dbc().partner.createConfigAndPoolWithFirstBuy({ ...common, firstBuyParam: { buyer: creatorPk, buyAmount: new BN(Math.round(firstBuySol * 1e9)), minimumAmountOut: new BN(1), referralTokenAccount: null } });
    txs = [r.createConfigTx, r.createPoolWithFirstBuyTx];
  } else {
    txs = [await P.dbc().partner.createConfigAndPool(common)];
  }
  const { blockhash, lastValidBlockHeight } = await P.connection().getLatestBlockhash('confirmed');
  const out = txs.map(tx => {
    tx.feePayer = creatorPk; tx.recentBlockhash = blockhash;
    const msg = tx.compileMessage(); const signers = msg.accountKeys.slice(0, msg.header.numRequiredSignatures).map(k => k.toBase58());
    const mine = [config, baseMint].filter(k => signers.includes(k.publicKey.toBase58()));
    if (mine.length) tx.partialSign(...mine);
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  });
  const pool = M.deriveDbcPoolAddress(SOL, baseMint.publicKey, config.publicKey);
  return { txs: out, mint: baseMint.publicKey.toBase58(), pool: pool.toBase58(), config: config.publicKey.toBase58(), lastValidBlockHeight };
}

export async function confirmLaunch(sig) {
  const r = await P.connection().getSignatureStatuses([sig], { searchTransactionHistory: true });
  const s = r.value[0];
  return { confirmed: !!s && !s.err && ['confirmed', 'finalized'].includes(s.confirmationStatus), err: s?.err || null };
}
