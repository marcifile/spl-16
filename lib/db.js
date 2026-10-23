import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(dir, { recursive: true });
export const db = new Database(path.join(dir, 'spline.db'));
db.pragma('journal_mode = WAL');
db.exec(`
create table if not exists coins (
  mint text primary key,
  pool text not null,
  config text not null,
  name text not null,
  ticker text not null,
  description text,
  image text,
  metadata_uri text,
  creator text not null,
  points text not null,                 -- json: 16 normalized heights
  shape text not null,
  tax_start_bps integer not null default 0,
  to_graduate_sol real not null,
  start_mcap_sol real not null,
  grad_mcap_sol real not null,
  launch_sig text,
  created_at integer not null,
  -- live
  progress real not null default 0,
  quote_reserve_sol real not null default 0,
  price_sol real,
  migrated integer not null default 0,
  fees_sol real not null default 0,
  hist text not null default '[]',      -- [[t, reserveSol, price]]
  last_seen integer
);
create table if not exists drafts (
  id text primary key,
  creator text,
  points text not null,
  tax_start_bps integer not null default 0,
  name text, ticker text,
  created_at integer not null
);
create index if not exists coins_created on coins(created_at desc);
`);
