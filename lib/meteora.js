// Shared Solana + Meteora DBC clients.
//
// Roles on every SPL-16 coin, in Meteora's terms:
//   partner = SPL-16 (HOUSE_WALLET). Fee claimer on each per-coin config; receives the partner share of trading fees.
//   creator = whoever drew the curve. Pool creator; receives the creator share (50%) of trading fees.
import { Connection, PublicKey } from '@solana/web3.js';
import { createRequire } from 'node:module';
const M = createRequire(import.meta.url)('@meteora-ag/dynamic-bonding-curve-sdk');

const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';
export const rpcUrl = () => process.env.SOLANA_RPC_URL || (process.env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : PUBLIC_RPC);
export const rpcState = () => ({ using: rpcUrl() === PUBLIC_RPC ? 'public Solana RPC' : 'Helius' });

let conn, client;
export const connection = () => (conn ||= new Connection(rpcUrl(), 'confirmed'));
export const dbc = () => (client ||= new M.DynamicBondingCurveClient(connection(), 'confirmed'));
export const houseWallet = () => new PublicKey(process.env.HOUSE_WALLET);
