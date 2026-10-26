// One-time: create a reusable Meteora DBC config ("config key") for launching $SPL-16 on Meteora's own UI.
// Standard SPL-16 curve, standard sniper tax (95% → 1% over 10 min), SPL-16 house as partner/fee claimer.
//   HOUSE_SECRET=<base58> node scripts/platform-config.mjs          # dry run: builds + simulates
//   HOUSE_SECRET=<base58> SEND=1 node scripts/platform-config.mjs   # sends
import { Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import { createRequire } from 'node:module';
import * as P from '../lib/meteora.js';
import { configFor, presetPoints, quote } from '../lib/curve.js';
const bs58 = createRequire(import.meta.url)('bs58');
const dec = (bs58.default || bs58).decode;

const payer = Keypair.fromSecretKey(dec(process.env.HOUSE_SECRET));
const house = new PublicKey(process.env.FEE_CLAIMER || process.env.HOUSE_WALLET || payer.publicKey);
const points = presetPoints('standard');
const NOTAX = !!process.env.NO_TAX;
const tax = { mode: 'exp', seconds: 600 };
const taxStartBps = NOTAX ? 0 : 9500;
const { cfg } = configFor({ points, taxStartBps, tax, opts: {} });
const q = quote({ points, taxStartBps, tax, opts: {} });
const config = Keypair.generate();
const tx = await P.dbc().partner.createConfig({ ...cfg, config: config.publicKey, feeClaimer: house, leftoverReceiver: house, quoteMint: new PublicKey('So11111111111111111111111111111111111111112'), payer: payer.publicKey });
tx.feePayer = payer.publicKey; tx.recentBlockhash = (await P.connection().getLatestBlockhash()).blockhash;
console.log({ config: config.publicKey.toBase58(), payer: payer.publicKey.toBase58(), house: house.toBase58(), toGraduateSol: q.toGraduateSol, startMcapSol: q.startMcapSol });
if (!process.env.SEND) { tx.sign(payer, config); const s = await P.connection().simulateTransaction(tx); console.log('simulate', s.value.err || 'ok', (s.value.logs || []).slice(-3)); process.exit(0); }
const sig = await sendAndConfirmTransaction(P.connection(), tx, [payer, config], { commitment: 'confirmed' });
console.log(`CONFIG_KEY=${config.publicKey.toBase58()}\nhttps://solscan.io/tx/${sig}`);
