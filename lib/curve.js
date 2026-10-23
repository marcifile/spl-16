// SPL-16: a hand-drawn bonding curve. 16 normalized points (0..1 price, evenly spaced over the sold supply)
// become a Meteora DBC config with up to 16 segments. Pure functions; no chain access.
import { createRequire } from 'node:module';
const M = createRequire(import.meta.url)('@meteora-ag/dynamic-bonding-curve-sdk');

export const N = 16;
export const SUPPLY = 1_000_000_000;              // tokens, 6 dp
export const START_MCAP_SOL = Number(process.env.START_MCAP_SOL || 28);   // price of point 1, as market cap
export const MAX_MCAP_SOL = Number(process.env.MAX_MCAP_SOL || 400);      // price of a point drawn at the top of the canvas
export const MIN_FEE_BPS = 100, MAX_FEE_BPS = 9500, TAX_SECONDS = 600;

// normalized 0..1 heights → strictly ascending token prices in SOL
export function pricesFromPoints(points) {
  if (!Array.isArray(points) || points.length !== N) throw new Error(`need ${N} points`);
  const p = points.map(v => Math.max(0, Math.min(1, Number(v) || 0)));
  for (let i = 1; i < N; i++) p[i] = Math.max(p[i], p[i - 1]);          // only up
  const lo = START_MCAP_SOL / SUPPLY, hi = MAX_MCAP_SOL / SUPPLY;
  const out = p.map(v => lo + (hi - lo) * v);
  for (let i = 1; i < N; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] * 1.0004; // DBC needs strictly ascending
  return out;
}

export function baseParams({ taxStartBps = 0, creatorPct = 50 }) {
  const tax = taxStartBps > 0;
  return {
    token: { tokenType: M.TokenType.SPLToken, tokenBaseDecimal: M.TokenDecimal.SIX, tokenQuoteDecimal: 9, tokenAuthorityOption: M.TokenAuthorityOption.Immutable, totalTokenSupply: SUPPLY, leftover: 1000 },
    fee: {
      baseFeeParams: { baseFeeMode: M.BaseFeeMode.FeeSchedulerExponential, feeSchedulerParam: tax ? { startingFeeBps: Math.min(MAX_FEE_BPS, Math.max(MIN_FEE_BPS, taxStartBps)), endingFeeBps: MIN_FEE_BPS, numberOfPeriod: 60, totalDuration: TAX_SECONDS } : { startingFeeBps: MIN_FEE_BPS, endingFeeBps: MIN_FEE_BPS, numberOfPeriod: 0, totalDuration: 0 } },
      dynamicFeeEnabled: true, collectFeeMode: M.CollectFeeMode.QuoteToken, creatorTradingFeePercentage: creatorPct, poolCreationFee: 0, enableFirstSwapWithMinFee: false,
    },
    migration: { migrationOption: M.MigrationOption.MET_DAMM_V2, migrationFeeOption: M.MigrationFeeOption.FixedBps100, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 } },
    liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 50, partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 50, creatorLiquidityPercentage: 0 },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: M.ActivationType.Timestamp,
  };
}

// Build the on-chain config params for a drawing.
export function configFor({ points, taxStartBps = 0 }) {
  const prices = pricesFromPoints(points);
  const sqrtPrices = M.createSqrtPrices(prices, M.TokenDecimal.SIX, 9);
  // Equal supply per segment (so the canvas x-axis really is % of supply): base sold in a segment is
  // L * (1/sqrtA - 1/sqrtB), so weight L_i ∝ 1 / (1/sqrtA - 1/sqrtB).
  const sq = sqrtPrices.map(b => Number(b.toString()));
  const raw = sq.slice(1).map((b, i) => 1 / (1 / sq[i] - 1 / b));
  const mx = Math.max(...raw); const liquidityWeights = raw.map(w => Math.max(1e-6, w / mx));
  const cfg = M.buildCurveWithCustomSqrtPrices({ ...baseParams({ taxStartBps }), sqrtPrices, liquidityWeights });
  return { cfg, prices };
}

// What the drawing means, in numbers people care about. Derived from the actual segments.
export function quote({ points, taxStartBps = 0 }) {
  const { cfg, prices } = configFor({ points, taxStartBps });
  const Q = 2n ** 64n; let cum = 0n; const cumSol = [];
  cfg.curve.forEach((seg, i) => {
    const a = i ? BigInt(cfg.curve[i - 1].sqrtPrice.toString()) : BigInt(cfg.sqrtStartPrice.toString());
    const b = BigInt(seg.sqrtPrice.toString()); const L = BigInt(seg.liquidity.toString());
    cum += (L * (b - a)) / Q / Q; cumSol.push(Number(cum) / 1e9);
  });
  const toGraduate = Number(cfg.migrationQuoteThreshold.toString()) / 1e9;
  const segPct = 100 / cfg.curve.length; // % of curve supply per segment (equal-width in our drawing)
  const sold = (cfg.tokenSupply?.preMigrationTokenSupply ? Number(cfg.tokenSupply.preMigrationTokenSupply.toString()) / 1e6 : SUPPLY * 0.8); // approx: tokens sold before migration
  const startPrice = prices[0], endPrice = prices[prices.length - 1];
  const first10 = cumSol[Math.max(0, Math.round(cfg.curve.length * 0.1) - 1)] ?? cumSol[0];
  const oneSolPct = Math.min(100, (1 / startPrice) / SUPPLY * 100);
  const shape = classify(points);
  return {
    points: points.map(Number), prices, cumSol, segments: cfg.curve.length,
    toGraduateSol: round(toGraduate, 2), first10Sol: round(first10, 3), oneSolBuysPct: round(oneSolPct, 2),
    startMcapSol: round(startPrice * SUPPLY, 1), gradMcapSol: round(endPrice * SUPPLY, 1), multiple: round(endPrice / startPrice, 1),
    soldOnCurvePct: round(sold / SUPPLY * 100, 1), shape, tax: taxStartBps > 0 ? { startBps: taxStartBps, endBps: MIN_FEE_BPS, seconds: TAX_SECONDS } : null,
  };
}

export function classify(pts) {
  const P = pts.map(Number); const dif = P.map((v, i) => (i ? v - P[i - 1] : 0));
  const late = dif.slice(8).reduce((s, v) => s + v, 0), early = dif.slice(0, 8).reduce((s, v) => s + v, 0);
  const flats = dif.filter(v => v < .012).length; let alt = 0; for (let i = 2; i < N; i++) if ((dif[i] < .012) !== (dif[i - 1] < .012)) alt++;
  const firstJump = dif.findIndex((v, i) => i > 0 && v > .04);
  if (alt >= 6 && flats >= 5) return 'stairs';
  if (flats >= 5 && firstJump >= 5 && late > early * 2) return 'cliff';
  if (early > late * 3) return 'fat';
  if (Math.abs(late - early) < .2) return 'ramp';
  return late > early ? 'hockey' : 'ramp';
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

export const PRESETS = {
  cliff: x => (x < .48 ? .02 + x * .03 : .035 + Math.pow((x - .48) / .52, 1.4) * .965),
  stairs: x => Math.min(1, Math.floor(x * 5) / 5 * .9 + .02),
  ramp: x => .02 + x * .98,
  hockey: x => .02 + Math.pow(x, 3.2) * .98,
  fat: x => .02 + (1 - Math.pow(1 - x, 3)) * .98,
};
export const presetPoints = name => Array.from({ length: N }, (_, i) => PRESETS[name](i / (N - 1)));
