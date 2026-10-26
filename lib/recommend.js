// Curve recommendations from a creator's plain-language launch goals.
// With OPENAI_API_KEY (or ANTHROPIC_API_KEY) set, a model drafts a curve + sniper tax and checks its drafts against the real
// DBC quote (tool use) before proposing. Without a key, a rule-based recommender answers the same request.
import * as C from './curve.js';

const N = C.N;
const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
const mono = P => { const o = P.map(clamp01); for (let i = 1; i < N; i++) o[i] = Math.max(o[i], o[i - 1]); return o; };
const TAX = { off: null, fast: { mode: 'exp', seconds: 180 }, standard: { mode: 'exp', seconds: 600 }, gradual: { mode: 'linear', seconds: 900 } };

function stats(points, tax) {
  const q = C.quote({ points: mono(points), taxStartBps: tax ? 9500 : 0, tax: tax || {} });
  return { solToGraduate: q.toGraduateSol, first10PctCostSol: q.first10Sol, oneSolBuysPctOfSupply: q.oneSolBuysPct, launchMcapSol: q.startMcapSol, graduationMcapSol: q.gradMcapSol, shape: q.shape };
}

// ---- rule-based ------------------------------------------------------------------------------
// Family of curves h(x) = s + (1 − s)·x^k. Larger k = flatter early, lower graduation target.
const family = (s, k) => Array.from({ length: N }, (_, i) => s + (1 - s) * Math.pow(i / (N - 1), k));
function fitTarget(target, s) {
  let lo = .4, hi = 8, best = null;
  for (let it = 0; it < 28; it++) { const k = (lo + hi) / 2, P = family(s, k), g = stats(P).solToGraduate; best = { P, g }; if (g > target) lo = k; else hi = k; }
  return best;
}
export function ruleBased(prompt = '') {
  const t = prompt.toLowerCase();
  const num = (t.match(/(\d{2,3}(?:\.\d+)?)\s*(?:sol)?\s*(?:to )?(?:grad|graduat|target|threshold)/) || t.match(/(?:grad\w*|target|threshold)[^\d]{0,20}(\d{2,3}(?:\.\d+)?)/) || [])[1];
  const has = (...w) => w.some(x => t.includes(x));
  let goal = 'balanced';
  if (has('snip', 'bot', 'bundle', 'mev')) goal = 'sniper';
  else if (has('fair', 'community', 'wide', 'distribut', 'holders')) goal = 'fair';
  else if (has('cheap', 'low entry', 'easy', 'accessib', 'fast grad', 'quick', 'small')) goal = 'low';
  const base = { low: [.002, 2.6], balanced: [0, 2.1], fair: [.01, 1.5], sniper: [.12, 1.15] }[goal];
  let P, why;
  if (num) { const r = fitTarget(Math.max(60, Math.min(250, Number(num))), base[0]); P = r.P; why = `Shaped to graduate on about ${r.g} SOL`; }
  else { const G = { low: x => (x < .5 ? .002 + x * .02 : .012 + Math.pow((x - .5) / .5, 2) * .988), balanced: x => C.PRESETS.standard(x), fair: x => .01 + .45 * x + .54 * Math.pow(x, 3), sniper: x => .12 + .88 * Math.pow(x, 1.15) }[goal]; P = Array.from({ length: N }, (_, i) => G(i / (N - 1))); why = { low: 'Flat for most of the supply, so early buys stay cheap and it graduates on little SOL', balanced: 'A steady constant-product-like rise, the familiar baseline', fair: 'An even climb with no cheap stretch to sweep, so supply spreads across more buyers', sniper: 'Opens higher so the first buys cost more, and the price rises steadily after' }[goal]; }
  const taxKey = has('no tax', 'without tax') ? 'off' : goal === 'sniper' || has('snip', 'bot') ? 'gradual' : goal === 'low' ? 'fast' : 'standard';
  const s = stats(P, TAX[taxKey]);
  return { source: 'rules', title: { low: 'Low entry cost', balanced: 'Balanced growth', fair: 'Fair distribution', sniper: 'Sniper-resistant' }[goal], points: mono(P), tax: taxKey, rationale: `${why}. ${taxKey === 'off' ? 'No sniper tax.' : `Sniper tax: ${taxKey}.`}`, stats: s };
}

// ---- model-based -----------------------------------------------------------------------------
const SYSTEM = `You design bonding curves for SPL-16, a Solana launchpad on Meteora DBC.
A curve is 16 heights in [0,1], evenly spaced across the supply sold on the curve (x = 0%, 6.67% … 100%). Height maps linearly to market cap: 0 = ${C.START_MCAP_SOL} SOL, 1 = ${C.MAX_MCAP_SOL} SOL. Heights must be non-decreasing and the last should be near 1. Each of the 15 segments sells 1/15 of curve supply; flat stretches are deep and cheap, steep stretches are thin and expensive. The SOL needed to graduate is the area under the curve.
Reference quotes: standard x·y=k ≈ 84 SOL to graduate (first 10% ≈ 3.3 SOL); low-entry (flat first half, steep end) ≈ 75 SOL; fair (steady climb) ≈ 117 SOL; sniper-resistant (opens at height 0.12) ≈ 144 SOL with first 10% ≈ 7.5 SOL.
Sniper tax options: off, fast (3 min), standard (10 min), gradual (15 min linear). Fees start at 95% and fall to 1%.
Use the quote tool to check drafts against the creator's goals (at most 3 checks), then call propose exactly once. Keep the rationale to two short plain sentences, no hype.`;
const TOOLS = [
  { name: 'quote', description: 'Quote a draft curve with the real DBC math.', input_schema: { type: 'object', properties: { points: { type: 'array', items: { type: 'number' }, minItems: 16, maxItems: 16 }, tax: { type: 'string', enum: ['off', 'fast', 'standard', 'gradual'] } }, required: ['points', 'tax'] } },
  { name: 'propose', description: 'Final recommendation.', input_schema: { type: 'object', properties: { title: { type: 'string' }, points: { type: 'array', items: { type: 'number' }, minItems: 16, maxItems: 16 }, tax: { type: 'string', enum: ['off', 'fast', 'standard', 'gradual'] }, rationale: { type: 'string' } }, required: ['title', 'points', 'tax', 'rationale'] } },
];
async function modelBased(prompt) {
  const key = process.env.ANTHROPIC_API_KEY; const model = process.env.RECOMMEND_MODEL || 'claude-haiku-5-5';
  const messages = [{ role: 'user', content: `Creator's launch goals: ${prompt.slice(0, 600)}` }];
  for (let turn = 0; turn < 6; turn++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 1200, system: SYSTEM, tools: TOOLS, messages }) });
    if (!r.ok) throw new Error(`model ${r.status}`);
    const j = await r.json(); messages.push({ role: 'assistant', content: j.content });
    const uses = j.content.filter(b => b.type === 'tool_use'); if (!uses.length) break;
    const results = [];
    for (const u of uses) {
      if (u.name === 'propose') { const P = mono(u.input.points); const tax = TAX[u.input.tax] !== undefined ? u.input.tax : 'standard'; return { source: 'model', title: String(u.input.title).slice(0, 40), points: P, tax, rationale: String(u.input.rationale).slice(0, 300), stats: stats(P, TAX[tax]) }; }
      let out; try { out = stats(u.input.points, TAX[u.input.tax]); } catch (e) { out = { error: e.message }; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error('no proposal');
}

// OpenAI: same tools, Chat Completions function calling.
async function openaiBased(prompt) {
  const key = process.env.OPENAI_API_KEY; const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const tools = TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Creator's launch goals: ${prompt.slice(0, 600)}` }];
  for (let turn = 0; turn < 6; turn++) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages, tools, tool_choice: turn >= 4 ? { type: 'function', function: { name: 'propose' } } : 'auto' }) });
    if (!r.ok) throw new Error(`openai ${r.status} ${(await r.text()).slice(0, 120)}`);
    const msg = (await r.json()).choices[0].message; messages.push(msg);
    const calls = msg.tool_calls || []; if (!calls.length) { messages.push({ role: 'user', content: 'Call propose now.' }); continue; }
    for (const c of calls) {
      let a = {}; try { a = JSON.parse(c.function.arguments); } catch {}
      if (c.function.name === 'propose' && Array.isArray(a.points) && a.points.length === N) { const P = mono(a.points); const tax = TAX[a.tax] !== undefined ? a.tax : 'standard'; return { source: 'model', title: String(a.title || 'Suggested curve').slice(0, 40), points: P, tax, rationale: String(a.rationale || '').slice(0, 300), stats: stats(P, TAX[tax]) }; }
      let out; try { out = stats(a.points, TAX[a.tax]); } catch (e) { out = { error: e.message }; }
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(out) });
    }
  }
  throw new Error('no proposal');
}

export async function recommend(prompt) {
  if (process.env.OPENAI_API_KEY) { try { return await openaiBased(prompt); } catch (e) { console.error('recommend openai', e.message); } }
  if (process.env.ANTHROPIC_API_KEY) { try { return await modelBased(prompt); } catch (e) { console.error('recommend model', e.message); } }
  return ruleBased(prompt);
}
