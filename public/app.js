// SPL-16 frontend. Routes: / , /coins , /lab , /c/:mint , /mine , /standard
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = a => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '—');
const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? `${s | 0}s` : s < 3600 ? `${(s / 60) | 0}m` : s < 86400 ? `${(s / 3600) | 0}h` : `${(s / 86400) | 0}d`; };
const sol = (n, d = 1) => `${Number(n || 0).toFixed(d)} SOL`;
const big = n => { n = Number(n || 0); return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(0); };
const N = 16;
let S = null, wallet = null, PRESETS = null, LIVE = null;

// ---------- curve drawing helpers ----------
function curvePath(points, W, H, pad) {
  const pts = points.map((v, i) => [pad + (W - 2 * pad) * i / (N - 1), H - pad - (H - 2 * pad) * v]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2; d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`; }
  return { d, pts };
}
const glyph = (points, w = 40, h = 24) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${curvePath(points, w, h, 3).d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const iconSvg = points => { const s = 200, { d, pts } = curvePath(points, s, s, 32), e = pts[pts.length - 1]; return `<svg viewBox="0 0 ${s} ${s}"><rect width="${s}" height="${s}" fill="#f4f2ec"/><path d="${d}" fill="none" stroke="#111114" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${e[0].toFixed(1)}" cy="${e[1].toFixed(1)}" r="5.6" fill="#f4f2ec"/></svg>`; };
const coinIcon = c => c.logo ? `<img src="${esc(c.logo)}" alt="">` : `<span class="mono-ic">${esc((c.ticker || '?')[0])}<i></i></span>`;
// a spline weight ("duck"): lead body, brass prong that holds the strip at the point
const DUCK = `<svg viewBox="0 0 44 30" class="duck-svg"><path d="M22 2 L22 9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M4 26 C4 15 13 9 23 9 C31 9 37 13 40 18 C41.5 21 40 26 36 26 Z" fill="currentColor"/><circle cx="22" cy="2.6" r="2.2" fill="currentColor"/></svg>`;
// Meteora exponential fee scheduler, as configured: 95% → 1% in 60 steps over 600s
// Meteora's fee scheduler: 95% at open, stepping every 10 s to 1% over T.seconds, linear or exponential
let TAX = { mode: 'exp', seconds: 600 }, LPFEE = 100, VOLFEE = true;
const taxAt = (s, T = TAX) => { const P = T.seconds / 10, n = Math.min(P, Math.floor(s / 10)); return T.mode === 'linear' ? 95 - (94 * n) / P : 95 * Math.pow(1 / 95, n / P); };
const mmss = s => `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}`;
// launch goals: a curve plus a sniper tax, each tuned for one outcome
const GOALS = [
  ['low', 'Low entry cost', x => (x < .5 ? .002 + x * .02 : .012 + Math.pow((x - .5) / .5, 2) * .988), 'fast', 'Half the supply sells near the launch price, and the curve graduates on the least SOL. Fast tax.'],
  ['balanced', 'Balanced growth', null, 'standard', 'The constant-product curve most launchpads use. A familiar baseline. Standard tax.'],
  ['fair', 'Fair distribution', x => .01 + .45 * x + .54 * Math.pow(x, 3), 'standard', 'Price climbs steadily the whole way, so no stretch of supply is cheap to sweep. Standard tax.'],
  ['sniper', 'Sniper-resistant', x => .12 + .88 * Math.pow(x, 1.15), 'gradual', 'Opens higher, so the first 10% costs about twice as much, with a slow 15-minute tax on top.'],
];
let TAXMAX = 1200, HOLDER = false, CEIL = 400;
const coinOpts = c => { try { return c.opts_json ? JSON.parse(c.opts_json) : {}; } catch { return {}; } };
const hiOf = c => coinOpts(c).maxMcap || S.config.maxMcapSol;
const TAXP = [['off', null], ['fast', { mode: 'exp', seconds: 180 }], ['standard', { mode: 'exp', seconds: 600 }], ['gradual', { mode: 'linear', seconds: 900 }], ['long', { mode: 'exp', seconds: 3600 }], ['custom', null]];
const taxGlyph = T => { if (!T) return `<svg viewBox="0 0 34 20" width="34" height="20"><path d="M3 17 L31 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" ${''}/></svg>`; let d = 'M3,3'; for (let s = 10; s <= 1200; s += 30) { const x = 3 + s / 1200 * 28, y = 3 + (95 - taxAt(s, T)) / 94 * 14; d += ` L${x.toFixed(1)},${y.toFixed(1)}`; } return `<svg viewBox="0 0 34 20" width="34" height="20"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; };

// ---------- wallet ----------
const provider = () => window.solana || window.phantom?.solana;
async function connect() { const p = provider(); if (!p) { alert('No Solana wallet found. Install Phantom.'); return null; } const r = await p.connect(); wallet = r.publicKey.toString(); paintWallet(); return wallet; }
function paintWallet() { window.dispatchEvent(new Event('wallet')); const b = $('#wallet span'); b.textContent = wallet ? short(wallet) : 'Connect'; }
$('#wallet').onclick = async () => { if (wallet) { try { await provider().disconnect(); } catch {} wallet = null; paintWallet(); } else connect(); };
provider()?.connect?.({ onlyIfTrusted: true }).then(r => { wallet = r.publicKey.toString(); paintWallet(); }).catch(() => {});
async function state() { S = await (await fetch('/api/state')).json(); if (!PRESETS) PRESETS = await (await fetch('/api/presets')).json(); return S; }

// ---------- the drawing board ----------
function canvasHTML() {
  return `
  <div class="leftcol"><div class="card lab-card">
    <div class="ch"><h2>Lines plan <span class="sub">market cap against supply sold</span></h2><div class="chr"><span class="rule warn" id="rule" style="display:none"></span><button class="btn sm" id="clear">Clear</button></div></div>
    <div class="stage"><div class="canvas board" id="cv">
      <div class="stations" id="stations"></div>
      <svg id="svg" viewBox="0 0 1000 560" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#111114" stop-opacity=".06"/><stop offset="1" stop-color="#111114" stop-opacity="0"/></linearGradient></defs>
        <g id="ticks"></g><path id="area" fill="url(#fill)"/><g id="ink"></g><path id="raw" fill="none"/><path id="strip" pathLength="1" fill="none" stroke="#e9dcc0" stroke-width="7" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/><path id="line" pathLength="1" fill="none" stroke="#111114" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><g id="fixes"></g></svg>
      <div id="ducks"></div>
      <svg class="wm-swan" viewBox="0 0 100 100"><use href="#m16"/></svg>
      <svg class="ghost" id="ghost" viewBox="0 0 1000 560" preserveAspectRatio="none"><path id="gp" d="M70,500 C260,492 380,470 470,420 C560,370 620,260 700,200 C770,150 860,120 930,90" fill="none" stroke="#111114" stroke-opacity=".22" stroke-width="2.5" stroke-linecap="round" vector-effect="non-scaling-stroke" pathLength="1"/></svg>
      <div class="nib" id="nib"><svg viewBox="0 0 24 24"><path d="M3 21l3.5-1 11-11-2.5-2.5-11 11L3 21z" fill="#111114"/><path d="M15 6.5l2.5 2.5 2.2-2.2a1.2 1.2 0 000-1.7l-.8-.8a1.2 1.2 0 00-1.7 0L15 6.5z" fill="#111114"/></svg></div>
      <div class="ylab" id="ylab"></div><div class="xlab" id="xlab"></div>
      <div class="hint" id="hint"><b>Draw here, left to right</b>Release, and sixteen weights pin your line in place.</div>
      <div id="anns"></div><div class="toast" id="toast">price can't go down — that part was flattened</div>
    </div></div>
    <div class="legend"><span><span class="duckleg">${DUCK}</span>16 points (ducks)</span><span><span class="sw strip"></span>the spline</span><span><span class="sw" style="background:var(--bad)"></span>flattened</span><span class="r mono">y · mcap SOL · x · supply sold</span></div>
  </div>
  <div class="card taxcard" id="taxcard">
    <div class="ch"><h2>Sniper tax <span class="sub" id="taxsub">fee over the first 20 minutes · 95% at open, 1% floor</span></h2><span class="mono k-tax" id="k-tax">—</span></div>
    <div class="stage"><div class="canvas tax" id="taxbar"><svg id="taxsvg" viewBox="0 0 400 100" preserveAspectRatio="none">${[50, 25, 10].map(f => `<line x1="0" x2="400" y1="${(95 - f) / 94 * 100}" y2="${(95 - f) / 94 * 100}" stroke="#2f4a6d" stroke-opacity=".1" vector-effect="non-scaling-stroke"/>`).join('')}${[2, 4, 6, 8, 10, 12, 14, 16, 18].map(m => `<line x1="${m / 20 * 400}" x2="${m / 20 * 400}" y1="0" y2="100" stroke="#2f4a6d" stroke-opacity="${m % 10 ? .06 : .14}" vector-effect="non-scaling-stroke"/>`).join('')}<path id="taxarea" fill="#c8443a" fill-opacity=".08"/><path id="taxink" fill="none" stroke="#17171a" stroke-opacity=".35" stroke-width="2.5" stroke-linecap="round" vector-effect="non-scaling-stroke"/><path id="taxline" fill="none" stroke="#c8443a" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><span class="axis" style="left:8px;top:6px">95%</span><span class="axis" style="left:8px;bottom:6px">1%</span><span class="axis" style="left:8px;top:${(95 - 50) / 94 * 100}%;transform:translateY(-50%)">50%</span><span class="axis" id="taxend" style="right:8px;bottom:6px">20 min</span><span class="axis" id="taxmid" style="left:50%;bottom:6px;transform:translateX(-50%)">10 min</span><div class="taxhint" id="taxhint">draw the decay</div></div><div class="taxoff" id="taxoff">Sniper tax is off. Pick a schedule in step 2, or choose custom and draw one here.</div></div>
  </div></div>
  <div class="side">
    <div class="card step" id="s1"><div class="sec">
      <div class="sh"><b>1</b><h3>Draw</h3><span class="shape-tag" id="k-shape" title="what your curve reads as">—</span></div>
      <div class="shapes" id="shapes"><div class="shape" data-s="custom" title="your own drawing"><svg viewBox="0 0 34 20" width="34" height="20"><path d="M4 16 C9 15 10 9 15 10 S22 13 24 7 29 3 30 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="2.2 2.6"/></svg><i>custom</i></div>${Object.keys(PRESETS).map(k => `<div class="shape" data-s="${k}" title="${k}">${glyph(PRESETS[k], 34, 20)}<i>${k}</i></div>`).join('')}</div>
      <div class="goals"><span class="gl-h">Or start from a goal</span><div class="gl" id="goals">${GOALS.map(g => `<button type="button" data-g="${g[0]}">${g[1]}</button>`).join('')}</div><p class="note" id="goalnote" style="display:none"></p></div>
      <div class="ask"><span class="gl-h">Or describe your launch</span>
        <div class="ask-row"><input id="askq" maxlength="300" placeholder="e.g. community coin, fair, graduate around 100 SOL, keep snipers out"><button type="button" class="btn sm" id="askgo">Suggest</button></div>
        <div class="ask-out" id="askout" style="display:none"></div></div>
      <div class="kvs">
        <div class="kv"><span>SOL to graduate</span><b id="k-grad">—</b></div>
        <div class="kv"><span>First 10% of supply costs</span><b id="k-first">—</b></div>
        <div class="kv"><span>1 SOL at launch buys</span><b id="k-buy">—</b></div>
        <div class="kv"><span>Market cap, launch → graduation</span><b id="k-mcap">—</b></div>
      </div></div></div>
    <div class="card step locked" id="s2"><div class="sec">
      <div class="sh"><b>2</b><h3>Sniper tax</h3><span class="shape-tag" id="k-fit">off</span></div>
      <div class="body">
        <div class="taxes" id="taxes">${TAXP.map(([k, t]) => `<div class="shape tx" data-t="${k}" title="${k}">${k === 'custom' ? '<svg viewBox="0 0 34 20" width="34" height="20"><path d="M3 3 C8 4 9 12 15 12 S26 15 31 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="2.2 2.6"/></svg>' : taxGlyph(t)}<i>${k}</i></div>`).join('')}</div>
        <p class="note" id="taxnote">No tax. Trades pay the normal 1% fee from the first block.</p>
      </div></div></div>
    <div class="card step locked" id="s3"><div class="sec">
      <div class="sh"><b>3</b><h3>Name</h3></div>
      <div class="body">
        <div class="grid2"><div class="field"><label>Name</label><input id="nm" placeholder="Ledge" maxlength="32"></div><div class="field"><label>Ticker</label><input id="tk" placeholder="LEDGE" maxlength="10" style="text-transform:uppercase"></div></div>
        <div class="field"><label>Description <span class="opt">optional</span></label><textarea id="ds" maxlength="300" placeholder="One line"></textarea></div>
        <div class="field"><label>Logo <span class="opt">optional · square · under 2 MB</span></label>
          <div class="logo-row"><div class="ic" id="pv"></div><div><input type="file" id="logo" accept="image/png,image/jpeg,image/webp,image/gif" hidden><button class="btn sm" id="logobtn" type="button">Upload image</button><button class="btn sm ghost" id="logoclr" type="button" style="display:none">Use curve</button><p class="note" style="margin-top:6px">Without a logo, the curve is the icon.</p></div></div>
        </div>
        <div class="field"><label>X <span class="opt">optional · handle or link</span></label><input id="tw" placeholder="@yourcoin" maxlength="80"></div>
        <p class="note" style="margin-top:6px">The coin's website is set to its page on spl-16.com.</p>
      </div></div></div>
    <div class="card step locked" id="s4"><div class="sec">
      <div class="sh"><b>4</b><h3>Launch</h3></div>
      <div class="body">
        <div class="opts">
          <div class="op"><span>Dev buy<small>bought in the launch transaction, before anyone else</small></span><div class="op-in"><input id="fb" type="number" min="0" max="50" step="0.05" placeholder="0"><em>SOL</em></div></div>
          <div class="op"><span>Pool fee after graduation<small>the DAMM v2 pool's swap fee</small></span><div class="seg2" id="lpfee">${[[25, '0.25%'], [100, '1%'], [200, '2%'], [400, '4%']].map(([v, t]) => `<button type="button" data-v="${v}" class="${v === 100 ? 'on' : ''}">${t}</button>`).join('')}</div></div>
          <div class="op"><span>Volatility fee<small>adds to the fee during sharp moves</small></span><label class="switch on" id="volsw"><i></i><span>on</span></label></div>
        </div>
        <div class="hgroup" id="hold">
          <div class="hg-h"><b><svg viewBox="0 0 100 100"><use href="#m16"/></svg>$SPL holder options</b><small id="holdtxt">Hold $SPL when you launch to unlock these.</small></div>
          <div class="op"><span>Creator fee share<small>written into this coin's config for good</small></span><b id="holdpct">50%</b></div>
          <div class="op"><span>Board ceiling<small>draw curves up to a 1,000 SOL market cap</small></span><div class="seg2" id="ceil"><button type="button" data-v="400" class="on">400</button><button type="button" data-v="1000">1,000</button></div></div>
          <div class="op"><span>Long sniper tax<small>a 60-minute window on the tax board</small></span><b class="hv">60m</b></div>
          <div class="op"><span>Featured slot<small>pinned on the home page for an hour, with a holder badge</small></span><b class="hv">auto</b></div>
        </div>
        <button class="btn pri big wide" id="launch" disabled>Connect wallet to launch</button>
        <div class="err" id="err"></div>
        <p class="note">Signed in your wallet. Creates the coin's DBC config and pool on Meteora in one go. The curve can't be changed afterwards. Network cost ≈ 0.03 SOL plus your first buy.</p>
      </div></div></div>
  </div>`;
}

function mountCanvas(root, { compact = false } = {}) {
  root.innerHTML = canvasHTML();
  const W = 1000, H = 560, PAD = 36; const cv = $('#cv'); let raw = [], pts = null, fixed = [], drawing = false, toastT = null, quoteT = null, taxOn = false, logoData = null, lastQ = null;
  const toSvg = e => { const r = cv.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: (t.clientX - r.left) / r.width * W, y: (t.clientY - r.top) / r.height * H }; };
  const price = p => (H - PAD - p.y) / (H - 2 * PAD);
  let reached = 1; const stepOn = (n, on) => { if (on) reached = Math.max(reached, n); $(`#s${n}`).classList.toggle('locked', !on && n > reached); };
  let picked = null; const pick = k => { picked = k; document.querySelectorAll('.shape').forEach(s => s.classList.toggle('on', s.dataset.s === k)); };
  const lo = S.config.startMcapSol; let hi = CEIL;
  const relabel = () => { hi = CEIL; $('#ylab').innerHTML = [1, .75, .5, .25, 0].map(v => `<span style="top:${(PAD + (H - 2 * PAD) * (1 - v)) / H * 100}%">${Math.round(lo + (hi - lo) * v)}</span>`).join('') + `<span class="axt">SOL</span>`; };
  CEIL = 400; relabel();
  $('#xlab').innerHTML = [0, 20, 40, 60, 80, 100].map(v => `<span style="left:${(PAD + (W - 2 * PAD) * v / 100) / W * 100}%">${v}%</span>`).join('');
  $('#stations').innerHTML = Array.from({ length: N }, (_, i) => `<span style="left:${(PAD + (W - 2 * PAD) * i / (N - 1)) / W * 100}%">${i + 1}</span>`).join('');
  $('#ticks').innerHTML = [.25, .5, .75, 1].map(v => { const y = H - PAD - (H - 2 * PAD) * v; return `<line x1="${PAD}" x2="${W - PAD}" y1="${y}" y2="${y}" stroke="#2f4a6d" stroke-opacity=".09" vector-effect="non-scaling-stroke"/>`; }).join('') + Array.from({ length: N }, (_, i) => { const x = PAD + (W - 2 * PAD) * i / (N - 1), major = i % 3 === 0; return `<line x1="${x}" x2="${x}" y1="${PAD - 10}" y2="${H - PAD}" stroke="#2f4a6d" stroke-opacity="${major ? .16 : .08}" ${major ? '' : 'stroke-dasharray="2 5"'} vector-effect="non-scaling-stroke"/>`; }).join('') + `<line x1="${PAD}" x2="${W - PAD}" y1="${H - PAD}" y2="${H - PAD}" stroke="#2f4a6d" stroke-opacity=".35" vector-effect="non-scaling-stroke"/>`;
  function snap(samples) { const xs = [], ys = [], fx = []; for (let i = 0; i < N; i++) { const x = PAD + (W - 2 * PAD) * i / (N - 1); xs.push(x); let best = null, bd = 1e9; for (const p of samples) { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = p; } } ys.push(best ? best.y : H - PAD); } for (let i = 1; i < N; i++) { if (ys[i] > ys[i - 1] + .5) fx.push(i); ys[i] = Math.min(ys[i], ys[i - 1]); } for (let i = 0; i < N; i++) ys[i] = Math.max(PAD, Math.min(H - PAD, ys[i])); if (ys[N - 1] >= ys[0] - 8) ys[N - 1] = Math.max(PAD, ys[0] - 60); fixed = fx; return xs.map((x, i) => ({ x, y: ys[i] })); }
  function fromPoints(P) { raw = []; fixed = []; pts = P.map((v, i) => ({ x: PAD + (W - 2 * PAD) * i / (N - 1), y: H - PAD - (H - 2 * PAD) * v })); render(true); }
  function set(id, v) { const el = $(id); if (!el) return; if (el.textContent !== v) { el.textContent = v; el.classList.add('hot'); setTimeout(() => el.classList.remove('hot'), 250); } }
  function paintPreview() { $('#pv').innerHTML = logoData ? `<img src="${logoData}" alt="">` : (pts ? iconSvg(pts.map(price)) : ''); }
  function render(final) {
    $('#ghost').classList.toggle('off', !!(pts || raw.length));
    const rule = $('#rule');
    if (!pts) { ['#line', '#area', '#strip'].forEach(i => $(i).setAttribute('d', '')); $('#ducks').innerHTML = ''; $('#fixes').innerHTML = ''; $('#anns').innerHTML = ''; $('#hint').classList.remove('off'); rule.style.display = 'none'; ['#k-grad', '#k-first', '#k-buy', '#k-mcap', '#k-shape'].forEach(k => ($(k).textContent = '—')); if (!drawing) pick(null); stepOn(2, false); stepOn(3, false); stepOn(4, false); paintPreview(); return; }
    $('#hint').classList.add('off');
    const { d } = curvePath(pts.map(price), W, H, 0); // smooth spline through the ducks
    const sm = 'M' + pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L');
    const spline = (() => { let s = `M${pts[0].x},${pts[0].y}`; for (let i = 0; i < N - 1; i++) { const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2; const c1y = Math.min(p1.y, Math.max(p2.y, p1.y + (p2.y - p0.y) / 6)), c2y = Math.max(p2.y, Math.min(p1.y, p2.y - (p3.y - p1.y) / 6)); s += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)},${c1y.toFixed(1)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`; } return s; })();
    void d; void sm;
    $('#strip').setAttribute('d', spline); $('#line').setAttribute('d', spline); $('#area').setAttribute('d', spline + ` L${pts[N - 1].x},${H - PAD} L${pts[0].x},${H - PAD} Z`);
    $('#ducks').innerHTML = pts.map((p, i) => `<span class="duck${fixed.includes(i) ? ' bad' : ''}" style="left:${p.x / W * 100}%;top:${p.y / H * 100}%;--i:${i}" title="point ${i + 1}">${DUCK}</span>`).join('');
    $('#fixes').innerHTML = fixed.map(i => `<line x1="${pts[i - 1].x}" y1="${pts[i - 1].y}" x2="${pts[i].x}" y2="${pts[i].y}" stroke="#c8443a" stroke-width="3" vector-effect="non-scaling-stroke"/>`).join('');
    if (fixed.length) { rule.style.display = ''; rule.className = 'rule warn'; rule.innerHTML = `<i></i>${fixed.length} dip${fixed.length > 1 ? 's' : ''} flattened`; if (final) { clearTimeout(toastT); $('#toast').classList.add('on'); toastT = setTimeout(() => $('#toast').classList.remove('on'), 2200); } }
    else rule.style.display = 'none';
    const P = pts.map(price); paintPreview();
    const dif = P.map((v, i) => (i ? v - P[i - 1] : 0)); let bi = 1; for (let i = 1; i < N; i++) if (dif[i] > dif[bi]) bi = i; const flats = dif.filter(v => v < .012).length;
    const r = cv.getBoundingClientRect(); const px = p => ({ l: Math.max(80, Math.min(r.width - 80, p.x / W * r.width)), t: p.y / H * r.height }); const a = px(pts[bi]), b = px(pts[Math.max(1, Math.floor(N / 4))]);
    $('#anns').innerHTML = `<div class="ann" style="left:${a.l}px;top:${a.t - 14}px">steepest · station ${bi + 1}</div>` + (flats >= 4 ? `<div class="ann soft" style="left:${b.l}px;top:${b.t}px">${Math.round(flats / (N - 1) * 100)}% of supply near one price</div>` : '');
    clearTimeout(quoteT); quoteT = setTimeout(() => quote(P, final), final ? 0 : 120);
  }
  async function quote(P, final) {
    const r = await fetch('/api/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ points: P, taxStartBps: taxOn ? 9500 : 0, tax: TAX, opts: { maxMcap: CEIL, preview: HOLDER, creatorPct: HOLDER ? 70 : 50 } }) }); const q = await r.json();
    if (q.error) { $('#err').textContent = q.error; return; } lastQ = q; $('#err').textContent = '';
    set('#k-grad', sol(q.toGraduateSol, 1)); set('#k-first', sol(q.first10Sol, 2)); set('#k-buy', q.oneSolBuysPct + '% of supply'); set('#k-mcap', `${q.startMcapSol} → ${q.gradMcapSol} SOL`); set('#k-shape', q.shape);
    if (final) { stepOn(2, true); stepOn(3, true); stepOn(4, true); }
    updateLaunch();
  }
  function updateLaunch() { const b = $('#launch'); const named = $('#nm').value.trim().length > 0 && $('#tk').value.trim().length >= 2; b.disabled = !(pts && lastQ && named); b.textContent = !wallet ? 'Connect wallet to launch' : !pts ? 'Draw a curve first' : !named ? 'Name it first' : 'Launch this curve'; }
  // ink: a pen stroke whose width follows speed — slow is heavy, fast is thin
  let lastT = 0, inkW = 4;
  const ink = $('#ink');
  const inkSeg = (a, b, w) => ink.insertAdjacentHTML('beforeend', `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke-width="${w.toFixed(2)}"/>`);
  const start = e => { if (e.button && e.button !== 0) return; drawing = true; ink.innerHTML = ''; ink.classList.remove('fade'); cv.classList.remove('settle'); raw = [toSvg(e)]; lastT = performance.now(); inkW = 4; pts = null; render(); e.preventDefault(); };
  const move = e => { if (!drawing) return; const p = toSvg(e); const q = raw[raw.length - 1]; if (p.x >= q.x) { const t = performance.now(), v = Math.hypot(p.x - q.x, p.y - q.y) / Math.max(1, t - lastT); lastT = t; inkW = inkW * .7 + Math.max(1.3, Math.min(5.5, 5.8 - v * 2.2)) * .3; inkSeg(q, p, inkW); raw.push(p); } $('#ghost').classList.add('off'); $('#hint').classList.add('off'); e.preventDefault(); };
  const end = () => { if (!drawing) return; drawing = false; if (raw.length > 3) { pts = snap(raw); cv.classList.remove('settle'); void cv.offsetWidth; cv.classList.add('settle'); ink.classList.add('fade'); pick('custom'); document.querySelectorAll('#goals button').forEach(x => x.classList.remove('on')); $('#goalnote').style.display = 'none'; } raw = []; render(true); };
  const nib = $('#nib');
  cv.addEventListener('mousemove', e => { const r = cv.getBoundingClientRect(); nib.style.transform = `translate(${e.clientX - r.left}px,${e.clientY - r.top - 22}px)`; nib.classList.add('on'); nib.classList.toggle('down', drawing); });
  cv.addEventListener('mouseleave', () => nib.classList.remove('on'));
  cv.addEventListener('mousedown', start); window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
  cv.addEventListener('touchstart', start, { passive: false }); window.addEventListener('touchmove', move, { passive: false }); window.addEventListener('touchend', end);
  document.querySelectorAll('.shape').forEach(s => (s.onclick = () => { if (s.dataset.s === 'custom') { if (!pts) $('#hint').classList.add('nudge'), setTimeout(() => $('#hint').classList.remove('nudge'), 900); else pick('custom'); return; } ink.innerHTML = ''; cv.classList.remove('settle'); void cv.offsetWidth; cv.classList.add('settle'); fromPoints(PRESETS[s.dataset.s]); pick(s.dataset.s); }));
  $('#clear').onclick = () => { pts = null; raw = []; fixed = []; lastQ = null; ink.innerHTML = ''; render(); };
  ['#nm', '#tk'].forEach(id => $(id).addEventListener('input', () => { stepOn(4, true); updateLaunch(); }));
  // tax: the real schedule, read-only
  // sniper tax: draw the decay; fit mode + duration; show the real stepped schedule
  const tb = $('#taxbar'); let tdraw = false, traw = [];
  function paintTax() {
    const X = t => t / TAXMAX * 400, Y = f => (95 - f) / 94 * 100;
    let d = `M0,${Y(95)}`; for (let t = 10; t <= TAXMAX; t += 10) d += ` L${X(t)},${Y(taxAt(t - 10)).toFixed(2)} L${X(t)},${Y(taxAt(t)).toFixed(2)}`;
    $('#taxline').setAttribute('d', d); $('#taxarea').setAttribute('d', d + ' L400,100 L0,100 Z');
    set('#k-fit', taxOn ? `${TAX.mode === 'linear' ? 'linear' : 'exponential'} · ${mmss(TAX.seconds)}` : 'off');
    set('#k-tax', taxOn ? `1 min ${taxAt(60).toFixed(0)}% · 3 min ${taxAt(180).toFixed(0)}% · 5 min ${taxAt(300).toFixed(1)}%` : 'off');
  }
  function fitTax() {
    // samples: t in seconds, f in fee %, forced non-increasing from 95
    const S2 = traw.map(p => ({ t: p.x / 400 * TAXMAX, f: 95 - p.y / 100 * 94 })); let m = 95; S2.forEach(q => { m = Math.min(m, q.f); q.f = m; });
    const floor = S2[S2.length - 1].f; const hit = S2.find(q => q.f <= Math.max(2.5, floor + 3)); const sec = Math.max(60, Math.min(TAXMAX, Math.round((hit ? hit.t : S2[S2.length - 1].t) / 30) * 30));
    const err = mode => S2.filter(q => q.t <= sec).reduce((a, q) => a + (q.f - taxAt(q.t, { mode, seconds: sec })) ** 2, 0);
    TAX = { mode: err('linear') < err('exp') ? 'linear' : 'exp', seconds: sec }; paintTax();
  }
  const tp = e => { const r = tb.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: Math.max(0, Math.min(400, (t.clientX - r.left) / r.width * 400)), y: Math.max(0, Math.min(100, (t.clientY - r.top) / r.height * 100)) }; };
  const tdown = e => { if (!taxOn) return; tdraw = true; traw = [{ x: 0, y: 0 }, tp(e)]; $('#taxhint').classList.add('off'); e.preventDefault(); };
  const tmove = e => { if (!tdraw) return; const p = tp(e); if (p.x >= traw[traw.length - 1].x) traw.push(p); $('#taxink').setAttribute('d', 'M' + traw.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' L')); fitTax(); e.preventDefault(); };
  const tup = () => { if (!tdraw) return; tdraw = false; fitTax(); document.querySelectorAll('#taxes .tx').forEach(x => x.classList.toggle('on', x.dataset.t === 'custom')); $('#taxnote').textContent = 'Your drawn schedule: ' + $('#k-fit').textContent + '.'; $('#taxink').classList.add('fade'); if (pts) quote(pts.map(price), false); };
  tb.addEventListener('mousedown', tdown); window.addEventListener('mousemove', tmove); window.addEventListener('mouseup', tup);
  tb.addEventListener('touchstart', tdown, { passive: false }); window.addEventListener('touchmove', tmove, { passive: false }); window.addEventListener('touchend', tup);
  tb.addEventListener('mousedown', () => $('#taxink').classList.remove('fade'));
  paintTax();
  const setTax = (k, T) => {
    taxOn = k !== 'off'; if (T) TAX = { ...T }; if (k === 'off') TAX = { mode: 'exp', seconds: 600 };
    if (k !== 'custom') { traw = []; $('#taxink').setAttribute('d', ''); }
    document.querySelectorAll('#taxes .tx').forEach(x => x.classList.toggle('on', x.dataset.t === k));
    $('#taxcard').classList.toggle('on', taxOn); $('#s2').classList.toggle('tax-on', taxOn);
    $('#taxhint').classList.toggle('off', k !== 'custom' || traw.length > 0);
    $('#taxnote').textContent = !taxOn ? 'No tax. Trades pay the normal 1% fee from the first block.' : k === 'custom' ? 'Draw the decay on the tax board under the curve.' : `Trades pay 95% at open, falling to 1% over ${mmss(TAX.seconds)}.`;
    paintTax(); if (k === 'custom' && !traw.length) $('#taxcard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (pts) quote(pts.map(price), false);
  };
  document.querySelectorAll('#taxes .tx').forEach(x => (x.onclick = () => setTax(x.dataset.t, TAXP.find(t => t[0] === x.dataset.t)[1])));
  const ask = async () => {
    const q = $('#askq').value.trim(); const out = $('#askout'); if (q.length < 3) { $('#askq').focus(); return; }
    const b = $('#askgo'); b.disabled = true; b.textContent = 'Thinking…'; out.style.display = ''; out.innerHTML = '<span class="dim">Drafting a curve and checking it against the quote…</span>';
    try {
      const r = await fetch('/api/recommend', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: q }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error);
      ink.innerHTML = ''; cv.classList.remove('settle'); void cv.offsetWidth; cv.classList.add('settle'); fromPoints(j.points); pick(null);
      setTax(j.tax, TAXP.find(t => t[0] === j.tax)?.[1]); document.querySelectorAll('#goals button').forEach(x => x.classList.remove('on')); $('#goalnote').style.display = 'none';
      out.innerHTML = `<b>${esc(j.title)}</b><p>${esc(j.rationale)}</p><span class="mono">${j.stats.solToGraduate} SOL to graduate · first 10% ${j.stats.first10PctCostSol} SOL · tax ${esc(j.tax)}</span><small>Applied to the board. Redraw any part to adjust.</small>`;
    } catch (e) { out.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
    b.disabled = false; b.textContent = 'Suggest';
  };
  $('#askgo').onclick = ask; $('#askq').addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
  $('#goals').onclick = e => {
    const b = e.target.closest('button'); if (!b) return; const g = GOALS.find(x => x[0] === b.dataset.g);
    const f = g[2] || (x => PRESETS.standard[Math.round(x * (N - 1))]); const P = Array.from({ length: N }, (_, i) => Math.min(1, Math.max(0, f(i / (N - 1)))));
    ink.innerHTML = ''; cv.classList.remove('settle'); void cv.offsetWidth; cv.classList.add('settle'); fromPoints(P); pick(g[0] === 'balanced' ? 'standard' : null);
    setTax(g[3], TAXP.find(t => t[0] === g[3])[1]);
    document.querySelectorAll('#goals button').forEach(x => x.classList.toggle('on', x === b)); const n = $('#goalnote'); n.style.display = ''; n.textContent = g[4];
  };
  setTax('off');
  // holder boost: read the creator's $SPL balance (the server decides the real share at launch)
  async function paintHold() {
    const t = $('#holdtxt'), b = $('#holdpct'); if (!t) return;
    let h = { live: !!S.ca, min: 1_000_000, pct: 70, held: 0, eligible: false };
    if (wallet) { try { h = await (await fetch(`/api/holder/${wallet}`)).json(); } catch {} }
    const need = big(h.min);
    HOLDER = !!h.eligible; $('#hold').classList.toggle('on', HOLDER); b.textContent = HOLDER ? h.pct + '%' : '50%';
    t.textContent = HOLDER ? `You hold ${big(h.held)} $SPL. Unlocked for this launch.` : !h.live ? `Hold ${need} $SPL when you launch to unlock these. Live once $SPL launches.` : !wallet ? `Hold ${need} $SPL when you launch to unlock these. Connect to check.` : `You hold ${big(h.held)} $SPL. Hold ${need} to unlock these.`;
    TAXMAX = HOLDER ? 3600 : 1200; $('#taxend').textContent = `${TAXMAX / 60} min`; $('#taxmid').textContent = `${TAXMAX / 120} min`; $('#taxsub').textContent = `fee over the first ${TAXMAX / 60} minutes · 95% at open, 1% floor`;
    document.querySelectorAll('#taxes .tx[data-t="long"]').forEach(x => (x.style.display = HOLDER ? '' : 'none'));
    if (!HOLDER && CEIL !== 400) { CEIL = 400; document.querySelectorAll('#ceil button').forEach(x => x.classList.toggle('on', x.dataset.v === '400')); relabel(); }
    paintTax(); if (pts) quote(pts.map(price), false);
  }
  $('#ceil').onclick = e => { const v = +e.target.dataset.v; if (!v || !HOLDER) return; CEIL = v; document.querySelectorAll('#ceil button').forEach(x => x.classList.toggle('on', x === e.target)); relabel(); if (pts) quote(pts.map(price), false); };
  paintHold(); window.addEventListener('wallet', paintHold);
  // launch options
  $('#lpfee').onclick = e => { const v = e.target.dataset.v; if (!v) return; LPFEE = +v; document.querySelectorAll('#lpfee button').forEach(b => b.classList.toggle('on', b === e.target)); };
  $('#volsw').onclick = () => { VOLFEE = !VOLFEE; $('#volsw').classList.toggle('on', VOLFEE); $('#volsw span').textContent = VOLFEE ? 'on' : 'off'; };
  // logo
  $('#logobtn').onclick = () => $('#logo').click();
  $('#logo').onchange = () => { const f = $('#logo').files[0]; if (!f) return; if (f.size > 2_000_000) return ($('#err').textContent = 'logo must be under 2 MB'); const rd = new FileReader(); rd.onload = () => { logoData = rd.result; paintPreview(); $('#logoclr').style.display = ''; }; rd.readAsDataURL(f); };
  $('#logoclr').onclick = () => { logoData = null; $('#logo').value = ''; paintPreview(); $('#logoclr').style.display = 'none'; };
  // launch
  $('#launch').onclick = async () => {
    const err = $('#err'); err.textContent = '';
    if (!wallet && !(await connect())) return; updateLaunch(); if ($('#launch').disabled) return;
    const tkv = $('#tk').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''), nmv = $('#nm').value.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['SPL', 'SPL16', 'SPLINE'].includes(tkv) || ['spl16', 'spl', 'spline', 'splinestandard', 'thesplinestandard'].includes(nmv)) { err.textContent = 'That name and ticker are reserved for the official SPL-16 coin.'; return; }
    const body = { creator: wallet, opts: { lpFeeBps: LPFEE, volFee: VOLFEE, maxMcap: CEIL }, twitter: $('#tw').value, name: $('#nm').value, ticker: $('#tk').value, description: $('#ds').value, points: pts.map(price), taxStartBps: taxOn ? 9500 : 0, tax: TAX, firstBuySol: Number($('#fb').value) || 0, logo: logoData };
    const b = $('#launch'); b.disabled = true; b.textContent = 'Preparing…';
    try {
      const r = await fetch('/api/launch/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      if (j.dry) { location.href = `/c/${j.mint}`; return; }
      const prov = provider(); const W3 = window.solanaWeb3; let sig;
      for (let i = 0; i < j.txs.length; i++) {
        b.textContent = j.txs.length > 1 ? `Sign ${i + 1} of ${j.txs.length} in your wallet…` : 'Sign in your wallet…';
        const tx = W3.Transaction.from(Uint8Array.from(atob(j.txs[i]), c => c.charCodeAt(0)));
        const res = await prov.signAndSendTransaction(tx); sig = res.signature; b.textContent = 'Confirming…';
        if (i < j.txs.length - 1) await new Promise(ok => setTimeout(ok, 2500));
      }
      for (let tries = 0; tries < 24; tries++) {
        const c = await fetch('/api/launch/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint: j.mint, sig }) }); const cj = await c.json();
        if (c.ok) { location.href = `/c/${j.mint}?new=1`; return; }
        if (cj.detail) throw new Error('transaction failed on chain');
        await new Promise(ok => setTimeout(ok, 1500));
      }
      throw new Error('still confirming — check your wallet, then open Yours');
    } catch (e) { err.textContent = e.message; updateLaunch(); }
  };
  window.addEventListener('resize', () => pts && render(false));
  paintWallet(); updateLaunch();
  return { fromPoints };
}

// ---------- pages ----------
const mcapOf = c => (c.price_sol ? c.price_sol * 1e9 : c.start_mcap_sol);
// a coin card is a small plate: the drawn curve, with where the price is now
function plate(c, W = 290, H = 128) {
  const pad = 14, lo = S.config.startMcapSol, hi = hiOf(c);
  const X = f => pad + (W - 2 * pad) * f, Y = m => H - pad - (H - 2 * pad) * Math.max(0, Math.min(1, (m - lo) / (hi - lo)));
  const pts = c.points.map((v, i) => [X(i / (N - 1)), Y(lo + (hi - lo) * v)]);
  const d = 'M' + pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' L');
  const sold = Math.max(0, Math.min(1, c.sold_pct || 0)); const lx = X(sold), ly = Y(mcapOf(c));
  const done = pts.filter(p => p[0] <= lx); const prog = done.length ? 'M' + [...done, [lx, ly]].map(p => p.map(n => n.toFixed(1)).join(',')).join(' L') : '';
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="pl">
    ${pts.map(p => `<line x1="${p[0].toFixed(1)}" x2="${p[0].toFixed(1)}" y1="${pad}" y2="${H - pad}" class="st"/>`).join('')}
    <line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" class="bl"/>
    <path d="${d} L${pts[N - 1][0]},${H - pad} L${pts[0][0]},${H - pad} Z" class="ar"/><path d="${d}" class="ln"/>
    ${prog ? `<path d="${prog}" class="pg"/>` : ''}${pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="1.8" class="dk"/>`).join('')}
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4.5" class="now"/></svg>`;
}
function optTags(c) {
  const o = coinOpts(c), t = c.tax_json ? JSON.parse(c.tax_json) : null, out = [];
  if (c.tax_start_bps) out.push(`<i class="tg tax">tax 95→1% · ${mmss(t?.seconds || 600)}</i>`);
  if (o.devBuySol > 0) out.push(`<i class="tg">dev buy ${o.devBuySol} SOL</i>`);
  if (o.holder) out.push(`<i class="tg hold">$SPL holder${o.creatorPct === 70 ? ' · 70% to creator' : ''}</i>`);
  if (o.maxMcap === 1000) out.push(`<i class="tg">1,000 SOL board</i>`);
  if (o.lpFeeBps && o.lpFeeBps !== 100) out.push(`<i class="tg">${o.lpFeeBps / 100}% pool fee</i>`);
  if (o.volFee === false) out.push(`<i class="tg">no vol fee</i>`);
  if (c.twitter) out.push(`<i class="tg">X linked</i>`);
  return out.join('');
}
function coinCard(c) {
  const pct = c.migrated ? 100 : Math.round((c.progress || 0) * 100);
  return `<a class="pc" href="/c/${c.mint}">
    <div class="pc-id"><div class="lg">${coinIcon(c)}</div><div><b>${esc(c.name)}</b><span>$${esc(c.ticker)}</span></div><em>${ago(c.created_at)}</em></div>
    <div class="pc-n"><b>${mcapOf(c).toFixed(1)}</b><span>SOL mcap</span></div>
    ${optTags(c) ? `<div class="pc-tags">${optTags(c)}</div>` : ''}
    <div class="pc-bar"><i style="width:${Math.max(pct, 1)}%"></i></div>
    <svg class="pc-s" viewBox="0 0 100 100"><use href="#m16"/></svg>
    <div class="pc-f"><span>${c.migrated ? 'graduated' : pct + '% to graduation'}</span><span>${esc(c.shape)}${c.trades ? ' · ' + c.trades + ' trades' : ''}</span></div></a>`;
}
let SORT = 'mcap', SHAPE = '', QRY = '';
function sketchPad() {
  const el = $('#pad'), W = 600, H = 110, P = 10; let raw = [], on = false;
  $('#padg').innerHTML = Array.from({ length: N }, (_, i) => { const x = P + (W - 2 * P) * i / (N - 1); return `<line x1="${x}" x2="${x}" y1="${P}" y2="${H - P}"/>`; }).join('') + `<line class="b" x1="${P}" x2="${W - P}" y1="${H - P}" y2="${H - P}"/>`;
  const pt = e => { const r = el.getBoundingClientRect(), t = e.touches ? e.touches[0] : e; return { x: (t.clientX - r.left) / r.width * W, y: Math.max(P, Math.min(H - P, (t.clientY - r.top) / r.height * H)) }; };
  const down = e => { on = true; raw = [pt(e)]; $('#padd').innerHTML = ''; $('#padl').setAttribute('d', ''); $('#padhint').classList.add('off'); el.classList.remove('done'); e.preventDefault(); };
  const move = e => { if (!on) return; const p = pt(e); if (p.x >= raw[raw.length - 1].x) raw.push(p); $('#padink').setAttribute('d', 'M' + raw.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' L')); e.preventDefault(); };
  const up = () => {
    if (!on) return; on = false; if (raw.length < 4) return;
    const ys = []; for (let i = 0; i < N; i++) { const x = P + (W - 2 * P) * i / (N - 1); let b = raw[0]; for (const q of raw) if (Math.abs(q.x - x) < Math.abs(b.x - x)) b = q; ys.push(b.y); }
    for (let i = 1; i < N; i++) ys[i] = Math.min(ys[i], ys[i - 1]);
    const v = ys.map(y => Math.max(0, Math.min(1, (H - P - y) / (H - 2 * P)))); if (v[N - 1] - v[0] < .05) v[N - 1] = Math.min(1, v[0] + .2);
    const pts = v.map((h, i) => [P + (W - 2 * P) * i / (N - 1), H - P - (H - 2 * P) * h]);
    $('#padl').setAttribute('d', curvePath(v, W, H, 0).d.replace(/[\d.]+,[\d.]+/g, m => m) && 'M' + pts.map(q => q.map(n => n.toFixed(1)).join(',')).join(' L'));
    $('#padd').innerHTML = pts.map((q, i) => `<i style="left:${q[0] / W * 100}%;top:${q[1] / H * 100}%;--i:${i}"></i>`).join('');
    el.classList.remove('done'); void el.offsetWidth; el.classList.add('done');
    try { sessionStorage.setItem('sketch', JSON.stringify(v)); } catch {}
    $('#padgo').textContent = 'Launch this curve';
  };
  el.addEventListener('mousedown', down); el.addEventListener('touchstart', down, { passive: false });
  window.addEventListener('mousemove', move); window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up); window.addEventListener('touchend', up);
}
// hover a plate to read the curve: what a buyer pays at any point of supply
function scrub(el, c, W, H) {
  if (!el) return; const pad = 14, lo = S.config.startMcapSol, hi = hiOf(c);
  el.insertAdjacentHTML('beforeend', '<div class="scrub"><i></i><span></span></div>'); const sc = el.querySelector('.scrub'), lab = sc.querySelector('span');
  el.addEventListener('mousemove', e => {
    const r = el.getBoundingClientRect(); const f = Math.max(0, Math.min(1, ((e.clientX - r.left) / r.width * W - pad) / (W - 2 * pad)));
    const x = f * (N - 1), i = Math.min(N - 2, Math.floor(x)), t = x - i, v = c.points[i] + (c.points[i + 1] - c.points[i]) * t, m = lo + (hi - lo) * v;
    const px = (pad + (W - 2 * pad) * f) / W * r.width, py = (H - pad - (H - 2 * pad) * v) / H * r.height;
    sc.style.setProperty('--x', px + 'px'); sc.style.setProperty('--y', py + 'px'); sc.classList.add('on');
    lab.textContent = `${Math.round(f * 100)}% sold · ${m.toFixed(1)} SOL mcap`; lab.classList.toggle('l', px > r.width - 190);
  });
  el.addEventListener('mouseleave', () => sc.classList.remove('on'));
}
function home() {
  const T = S.totals;
  const shapes = Object.keys(PRESETS);
  const num = (v, k) => `<div><b>${v}</b><span>${k}</span></div>`;
  app.innerHTML = `<div class="page">
  <section class="hstrip">
    <div class="st-l"><h1>Draw the curve your coin trades on.</h1><p>${T.coins} coins drawn · ${Number(T.volume || 0).toFixed(1)} SOL traded · <button class="why" id="why">Why it's different</button></p></div>
    <div class="pad-c" id="pad"><svg viewBox="0 0 600 110" preserveAspectRatio="none"><g id="padg"></g><path id="padink" fill="none"/><path id="padl" fill="none" pathLength="1"/></svg><div id="padd"></div><span class="pad-hint" id="padhint">sketch one here</span></div>
    <a class="btn pri" id="padgo" href="/draw">Draw a curve</a>
  </section>
  ${(() => { const f = S.coins.filter(c => coinOpts(c).holder && Date.now() - c.created_at < 3600e3).slice(0, 3); return f.length ? `<section class="feat5"><div class="f5h"><b><svg viewBox="0 0 100 100"><use href="#m16"/></svg>Featured</b><span>launched by $SPL holders · pinned for an hour</span></div><div class="pgrid">${f.map(coinCard).join('')}</div></section>` : ''; })()}
  <div class="bar5">
    <div class="tabs" id="sort">${[['mcap', 'Market cap'], ['recent', 'Newest'], ['volume', 'Volume'], ['progress', 'Closest to graduation']].map(([k, t]) => `<button data-k="${k}" class="${SORT === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <label class="sel"><select id="shape"><option value="">All shapes</option>${shapes.map(k => `<option value="${k}" ${SHAPE === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    <label class="search"><i data-lucide="search"></i><input id="q" placeholder="Name, ticker or mint" value="${esc(QRY)}"></label>
  </div>
  <div class="pgrid" id="cgrid"></div></div>`;
  const paint = () => {
    let xs = S.coins.filter(c => (!SHAPE || c.shape === SHAPE) && (!QRY || (c.name + ' ' + c.ticker + ' ' + c.mint).toLowerCase().includes(QRY.toLowerCase())));
    xs.sort(SORT === 'recent' ? (a, b) => b.created_at - a.created_at : SORT === 'volume' ? (a, b) => (b.volume_sol || 0) - (a.volume_sol || 0) : SORT === 'progress' ? (a, b) => (b.progress || 0) - (a.progress || 0) : (a, b) => mcapOf(b) - mcapOf(a));
    $('#cgrid').innerHTML = xs.length ? xs.map(coinCard).join('') : `<div class="card empty" style="grid-column:1/-1"><b>${S.coins.length ? 'Nothing matches.' : 'No coins yet.'}</b><a href="/draw">Draw one →</a></div>`;
  };
  sketchPad();
  $('#why').onclick = () => {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal" id="modal"><div class="mbox">
      <button class="mx" id="mx" aria-label="Close">×</button>
      <svg class="mS" viewBox="0 0 100 100"><use href="#m16"/></svg>
      <h2>Your coin's market, by design.</h2>
      <p class="ml">On most launchpads every coin trades on the same bonding curve — same price path, same snipers, same outcome. SPL-16 lets the creator set the rules, and Meteora's program enforces them.</p>
      <div class="mg">
        <div><b>Custom curve</b><p>Draw any shape, or start from standard, cliff, stairs, ramp, hockey or fat. It compiles to 16 sqrt-prices and its own DBC config — not a preset with a different name.</p></div>
        <div><b>Sniper tax you draw</b><p>Buys can pay up to 95% at open, decaying to 1% on the schedule you draw — fast, slow, linear or exponential. The scheduler can only lower it.</p></div>
        <div><b>Launch options</b><p>Dev buy in the launch transaction, the pool fee after graduation, and a volatility fee — all shown on the coin so buyers see the rules up front.</p></div>
        <div><b>Nothing to pull</b><p>The config is immutable, the mint is revoked, and liquidity locks for good when the coin graduates to DAMM v2.</p></div>
        <div><b>Hold $SPL, earn more</b><p>Creators earn 50% of trading fees. Hold $SPL when you launch and your coin's config gives you 70% — enforced by Meteora for the life of the coin.</p></div>
      </div>
      <div class="mf"><a class="btn pri" href="/draw">Draw a curve</a><a class="btn" href="/standard">Read the standard</a></div>
    </div></div>`);
    const close = () => $('#modal')?.remove(); $('#mx').onclick = close; $('#modal').onclick = e => { if (e.target.id === 'modal') close(); }; document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  };
  $('#q').oninput = e => { QRY = e.target.value; paint(); };
  $('#sort').onclick = e => { const k = e.target.closest('button')?.dataset.k; if (!k) return; SORT = k; document.querySelectorAll('#sort button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); paint(); };
  $('#shape').onchange = e => { SHAPE = e.target.value; paint(); };
  paint();
}
function drawPage() {
  const lo = S.config.startMcapSol, hi = S.config.maxMcapSol;
  app.innerHTML = `<div class="page wide"><div class="ph2"><div><h1>Draw a curve</h1><p>Draw left to right. Your line is held at 16 points and becomes the coin's bonding curve on Meteora.</p></div><a class="xl" href="/standard">How it works →</a></div>
  <section class="lab" id="labroot"></section>
  <section class="explain" id="how">
    <div class="eh"><div><span class="std">FROM STROKE TO POOL</span><h2>What happens to your drawing</h2></div><p>Nothing about the curve is simulated. The board you draw on is the same math the pool will run.</p></div>
    <div class="flow">
      ${[
        ['01', 'Stroke', `You draw left to right. Any part that dips is flattened — on a bonding curve, price can never fall as supply is sold.`, flowArt(0)],
        ['02', '16 stations', `The stroke is held at 16 evenly spaced stations along the supply axis. Height maps to market cap: the bottom of the board is ${lo} SOL, the top is ${hi} SOL.`, flowArt(1)],
        ['03', '15 segments', `Each pair of neighbouring points becomes a constant-product segment. Liquidity per segment is solved so every segment sells exactly 1/15 of the curve supply.`, flowArt(2)],
        ['04', 'One config', `The 16 sqrt prices, liquidity, fees and migration settings are written to a new Meteora DBC config, created with the pool in your launch transaction. No one can edit it — including us.`, flowArt(3)],
        ['05', 'Graduation', `When the SOL raised reaches your curve's threshold, the pool migrates to a Meteora DAMM v2 pool. Liquidity is locked permanently, split between creator and platform.`, flowArt(4)],
      ].map(([n, t, p, art]) => `<div class="fl"><div class="fa">${art}</div><span class="n">${n}</span><b>${t}</b><p>${p}</p></div>`).join('')}
    </div>
  </section></div>`;
  const ctl = mountCanvas($('#labroot'));
  try { const sk = JSON.parse(sessionStorage.getItem('sketch') || 'null'); if (sk && sk.length === N) { sessionStorage.removeItem('sketch'); $('#cv').classList.add('settle'); ctl.fromPoints(sk); } } catch {}
}
// small diagrams for the five steps
function flowArt(k) {
  const P = [.02, .05, .08, .1, .14, .2, .24, .3, .34, .42, .5, .58, .7, .8, .92, 1];
  const W = 220, H = 110, pad = 12; const pts = P.map((v, i) => [pad + (W - 2 * pad) * i / 15, H - pad - (H - 2 * pad) * v]);
  const line = 'M' + pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' L');
  const base = `<line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" stroke="#2f4a6d" stroke-opacity=".35"/>`;
  if (k === 0) { const wob = pts.map((p, i) => [p[0], p[1] + (i === 7 ? 16 : i === 11 ? 12 : Math.sin(i * 1.7) * 3)]); return `<svg viewBox="0 0 ${W} ${H}">${base}<path d="M${wob.map(p => p.map(n => n.toFixed(1)).join(',')).join(' L')}" fill="none" stroke="#9a9aa3" stroke-dasharray="3 3"/><path d="${line}" fill="none" stroke="#111114" stroke-width="1.6"/><circle cx="${wob[7][0]}" cy="${wob[7][1]}" r="4" fill="none" stroke="#c8443a"/><circle cx="${wob[11][0]}" cy="${wob[11][1]}" r="4" fill="none" stroke="#c8443a"/></svg>`; }
  if (k === 1) return `<svg viewBox="0 0 ${W} ${H}">${base}${pts.map(p => `<line x1="${p[0]}" x2="${p[0]}" y1="${pad}" y2="${H - pad}" stroke="#2f4a6d" stroke-opacity=".12"/>`).join('')}<path d="${line}" fill="none" stroke="#111114" stroke-width="1.4"/>${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#111114"/>`).join('')}</svg>`;
  if (k === 2) return `<svg viewBox="0 0 ${W} ${H}">${base}${pts.slice(0, -1).map((p, i) => `<rect x="${p[0]}" y="${pts[i + 1][1]}" width="${(pts[i + 1][0] - p[0]) - 1.5}" height="${H - pad - pts[i + 1][1]}" fill="#111114" fill-opacity="${i % 2 ? .08 : .14}"/>`).join('')}<path d="${line}" fill="none" stroke="#111114" stroke-width="1.6"/><text x="${W / 2}" y="${pad + 4}" text-anchor="middle" font-family="JetBrains Mono" font-size="9" fill="#2f4a6d">each column = 1/15 of supply</text></svg>`;
  if (k === 3) return `<svg viewBox="0 0 ${W} ${H}"><rect x="30" y="14" width="160" height="82" rx="6" fill="#fff" stroke="#111114"/><text x="42" y="32" font-family="JetBrains Mono" font-size="9" fill="#111114">DBC config</text>${['sqrtPrices[16]', 'liquidity[15]', 'fee scheduler', 'migration: DAMM v2'].map((t, i) => `<text x="42" y="${50 + i * 13}" font-family="JetBrains Mono" font-size="8.5" fill="#56565e">${t}</text>`).join('')}<path d="M176 24 v10 h-10" fill="none" stroke="#2f4a6d"/><text x="150" y="88" font-family="JetBrains Mono" font-size="8" fill="#1f8a5a">immutable</text></svg>`;
  return `<svg viewBox="0 0 ${W} ${H}">${base}<path d="${line}" fill="none" stroke="#111114" stroke-width="1.6"/><line x1="${pts[15][0]}" x2="${pts[15][0]}" y1="${pad}" y2="${H - pad}" stroke="#1f8a5a" stroke-dasharray="3 3"/><circle cx="${pts[15][0]}" cy="${pts[15][1]}" r="4.5" fill="#1f8a5a"/><text x="${pts[15][0] - 6}" y="${H - 18}" text-anchor="end" font-family="JetBrains Mono" font-size="9" fill="#1f8a5a">→ DAMM v2</text></svg>`;
}
async function mine() {
  if (!wallet) { try { await provider()?.connect?.({ onlyIfTrusted: true }).then(r => { wallet = r.publicKey.toString(); paintWallet(); }); } catch {} }
  if (!wallet) { app.innerHTML = `<div class="wrap"><div class="card empty"><b>Connect a wallet</b>to see the curves you drew.<div style="margin-top:14px"><button class="btn pri" id="mc">Connect</button></div></div></div>`; $('#mc').onclick = async () => { if (await connect()) mine(); }; return; }
  const j = await (await fetch(`/api/mine/${wallet}`)).json();
  app.innerHTML = `<div class="wrap"><div class="ch" style="border:0;padding:0 0 18px"><h2 class="pg">Your curves <span class="sub">${j.coins.length} · ${short(wallet)}</span></h2><a class="btn pri" href="/draw">Draw another</a></div>
  ${j.coins.length ? `<div class="cgrid">${j.coins.map(coinCard).join('')}</div>` : `<div class="card empty"><b>Nothing yet.</b><a href="/draw">Draw your first curve.</a></div>`}</div>`;
}

// ---------- coin page (live) ----------
function tradeHTML(c, real) {
  if (c.migrated) return `<div class="card trade"><div class="sec"><h3>Trade</h3><p class="note" style="margin:0 0 12px">This coin has graduated to Meteora DAMM v2.</p><a class="btn pri wide" href="https://jup.ag/tokens/${c.mint}" target="_blank" rel="noreferrer">Trade on Jupiter</a></div></div>`;
  return `<div class="card trade"><div class="sec">
    <div class="tr-tabs" id="trtabs"><button data-s="buy" class="on">Buy</button><button data-s="sell">Sell</button></div>
    <div class="tr-bal" id="trbal">${wallet ? 'Loading balance…' : 'Connect a wallet to trade'}</div>
    <div class="tr-in"><input id="tramt" type="number" min="0" step="any" placeholder="0.0" inputmode="decimal"><span id="trunit">SOL</span></div>
    <div class="tr-q" id="trq"></div>
    <button class="btn pri wide big" id="trgo" ${real ? '' : 'disabled'}>${real ? (wallet ? 'Buy' : 'Connect wallet') : 'Trading off in dry run'}</button>
    <div class="err" id="trerr"></div><div class="note" id="trok"></div></div></div>`;
}
function mountTrade(c, real, after) {
  if (!$('#trtabs')) return; let side = 'buy', bal = { sol: 0, tokens: 0 };
  const paint = () => {
    $('#trunit').textContent = side === 'buy' ? 'SOL' : '$' + c.ticker;
    $('#trq').innerHTML = side === 'buy' ? [0.1, 0.5, 1].map(v => `<button data-v="${v}">${v} SOL</button>`).join('') : [25, 50, 100].map(v => `<button data-p="${v}">${v}%</button>`).join('');
    $('#trbal').innerHTML = !wallet ? 'Connect a wallet to trade' : `You hold <b>${big(bal.tokens)} $${esc(c.ticker)}</b> · ${bal.sol.toFixed(3)} SOL`;
    if (real) $('#trgo').textContent = !wallet ? 'Connect wallet' : side === 'buy' ? `Buy $${c.ticker}` : `Sell $${c.ticker}`;
    $('#trgo').classList.toggle('sell', side === 'sell');
  };
  const load = async () => { if (!wallet) return paint(); try { bal = await (await fetch(`/api/balance/${c.mint}/${wallet}`)).json(); } catch {} paint(); };
  $('#trtabs').onclick = e => { const s2 = e.target.dataset.s; if (!s2) return; side = s2; document.querySelectorAll('#trtabs button').forEach(b => b.classList.toggle('on', b.dataset.s === s2)); $('#tramt').value = ''; $('#trerr').textContent = ''; paint(); };
  $('#trq').onclick = e => { const b = e.target.closest('button'); if (!b) return; $('#tramt').value = b.dataset.v || +(bal.tokens * b.dataset.p / 100).toFixed(6); };
  $('#trgo').onclick = async () => {
    $('#trerr').textContent = ''; $('#trok').textContent = '';
    if (!wallet) { if (await connect()) load(); return; }
    const amount = Number($('#tramt').value); if (!(amount > 0)) return ($('#trerr').textContent = 'enter an amount');
    if (side === 'sell' && bal.tokens <= 0) return ($('#trerr').textContent = `You don't hold any $${c.ticker}.`);
    if (side === 'sell' && amount > bal.tokens + 1e-9) return ($('#trerr').textContent = `You only hold ${big(bal.tokens)} $${c.ticker}.`);
    if (side === 'buy' && bal.sol <= 0) return ($('#trerr').textContent = "You don't have any SOL in this wallet.");
    if (side === 'buy' && bal.sol < amount + 0.003) return ($('#trerr').textContent = `Not enough SOL — you have ${bal.sol.toFixed(4)} SOL (keep ~0.003 for fees).`);
    const b = $('#trgo'); b.disabled = true; b.textContent = 'Preparing…';
    try {
      const r = await fetch('/api/swap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint: c.mint, wallet, side, amount }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error);
      b.textContent = 'Sign in your wallet…';
      const tx = window.solanaWeb3.Transaction.from(Uint8Array.from(atob(j.tx), ch => ch.charCodeAt(0)));
      const res = await provider().signAndSendTransaction(tx);
      $('#trok').innerHTML = `${side === 'buy' ? 'Bought' : 'Sold'} ~${side === 'buy' ? big(j.out) + ' $' + esc(c.ticker) : j.out.toFixed(4) + ' SOL'} · <a href="https://solscan.io/tx/${res.signature}" target="_blank" rel="noreferrer">view tx ↗</a>`;
      $('#tramt').value = ''; setTimeout(() => { load(); after(); }, 2500); setTimeout(load, 8000);
    } catch (e) { const m = e.message || String(e); $('#trerr').textContent = /insufficient (lamports|funds)/i.test(m) ? 'Not enough SOL for this trade plus fees.' : /reject|cancel/i.test(m) ? 'Cancelled in your wallet.' : m; }
    b.disabled = false; paint();
  };
  load();
}
async function coinPage(mint) {
  const j = await (await fetch(`/api/coin/${mint}`)).json(); if (j.error) return notFound();
  const c = j.coin; const real = c.pool && c.pool !== 'dry'; const isNew = new URLSearchParams(location.search).get('new');
  app.innerHTML = `<div class="wrap">
  ${isNew ? `<div class="card banner"><i data-lucide="check-circle-2"></i><div><b>Live on Meteora.</b> Your curve is on chain and trading. Share the CA — and the drawing.</div><button class="btn sm" id="share">Copy link</button></div>` : ''}
  <div class="card coinhead"><div class="ic">${coinIcon(c)}</div>
    <div><h1>${esc(c.name)} <span class="tk">$${esc(c.ticker)}</span></h1>
      <div class="meta"><span class="g">${glyph(c.points, 40, 20)}</span><span>${esc(c.shape)} curve</span><span>·</span><span>by <a href="https://solscan.io/account/${c.creator}" target="_blank" rel="noreferrer">${short(c.creator)}</a></span><span>·</span><span>${ago(c.created_at)} ago</span>${c.migrated ? '<span class="tag good">graduated</span>' : '<span class="tag">on the curve</span>'}${c.tax_start_bps ? '<span class="tag">sniper tax</span>' : ''}</div>
      ${c.description ? `<p>${esc(c.description)}</p>` : ''}</div>
    <div class="acts">${real ? `<a class="btn pri" href="https://jup.ag/tokens/${c.mint}" target="_blank" rel="noreferrer">Buy on Jupiter</a><a class="btn" href="https://www.meteora.ag/dbc/${c.pool}" target="_blank" rel="noreferrer">Meteora</a><a class="btn" href="https://dexscreener.com/solana/${c.pool}" target="_blank" rel="noreferrer">Dexscreener</a>` : '<span class="tag">dry run</span>'}${c.twitter ? `<a class="btn" href="${esc(c.twitter)}" target="_blank" rel="noreferrer">X ↗</a>` : ''}<button class="btn" id="cpy">CA ${short(c.mint)}</button></div></div>
  <div class="two">
    <div>
      <div class="card"><div class="ch"><h2>On the curve <span class="sub" id="pos">—</span></h2><span class="livetag" id="lt"><i></i>live</span></div><div class="chartbox" id="chart"></div></div>
      <div class="card" style="margin-top:20px"><div class="ch"><h2>Market cap <span class="sub">SOL · every trade</span></h2></div><div class="chartbox sm" id="mchart"></div></div>
      <div class="card" style="margin-top:20px"><div class="ch"><h2>Trades <span class="sub" id="tcount"></span></h2></div><div id="trades"></div></div>
    </div>
    <aside>
      ${tradeHTML(c, real)}
      <div class="card" style="margin-top:20px"><div class="sec" id="stats"></div></div>
      <div class="card" style="margin-top:20px"><div class="ch"><h2>The curve <span class="sub">as drawn</span></h2><span class="rule"><i></i>immutable</span></div>
        <div class="spec2 one"><div><span>to graduate</span><b>${sol(c.to_graduate_sol, 1)}</b></div><div><span>launch → graduation mcap</span><b>${c.start_mcap_sol} → ${c.grad_mcap_sol} SOL</b></div><div><span>sniper tax</span><b>${c.tax_start_bps ? (() => { const t = c.tax_json ? JSON.parse(c.tax_json) : { mode: 'exp', seconds: 600 }; return `95% → 1% · ${t.mode === 'linear' ? 'linear' : 'exponential'} · ${mmss(t.seconds)}`; })() : 'none'}</b></div><div><span>launch options</span><b class="tgs">${optTags(c) || 'defaults'}</b></div><div><span>config</span><b>${real ? `<a href="https://solscan.io/account/${c.config}" target="_blank" rel="noreferrer">${short(c.config)}</a>` : '—'}</b></div></div>
        ${c.logo ? `<div class="sec" style="border-top:1px solid var(--line);display:flex;gap:14px;align-items:center"><div class="ic sm">${iconSvg(c.points)}</div><div class="note" style="margin:0">The drawing, as an icon. It's also stored in the token metadata.</div></div>` : ''}</div>
      <div class="card" style="margin-top:20px"><div class="sec"><h3><i data-lucide="link"></i>Addresses</h3><div class="addr">${c.mint}</div><p class="note">mint</p><div class="addr">${esc(c.pool)}</div><p class="note">pool</p>${real ? `<p class="note"><a href="https://solscan.io/tx/${c.launch_sig}" target="_blank" rel="noreferrer">launch transaction ↗</a></p>` : ''}</div></div>
    </aside>
  </div></div>`;
  $('#cpy').onclick = () => { navigator.clipboard.writeText(c.mint); $('#cpy').textContent = 'copied'; };
  const sh = $('#share'); if (sh) sh.onclick = () => { navigator.clipboard.writeText(`${location.origin}/c/${c.mint}`); sh.textContent = 'copied'; };
  paintLive({ coin: c, hist: j.hist || [], trades: j.trades || [] });
  mountTrade(c, real, () => tick());
  async function tick() { return tick0(); }
  const tick0 = async () => { if (!location.pathname.endsWith(mint)) return; try { const r = await fetch(`/api/coin/${mint}/live`); if (r.ok) paintLive(await r.json()); } catch {} };
  clearInterval(LIVE); LIVE = setInterval(tick, 8000); tick();
}
function paintLive({ coin: c, hist, trades }) {
  if (!$('#chart')) return;
  const lo = S.config.startMcapSol, hi = hiOf(c); const mc = mcapOf(c); const sold = c.sold_pct || 0; const pct = Math.round((c.progress || 0) * 100);
  $('#chart').innerHTML = chartSvg(c, hist);
  $('#pos').textContent = `${(sold * 100).toFixed(1)}% sold · ${mc.toFixed(1)} SOL mcap`;
  $('#mchart').innerHTML = mcapSvg(c, hist, trades);
  const buys = trades.filter(t => t.side === 'buy').length;
  $('#tcount').textContent = trades.length ? `${c.trades || trades.length} total · ${buys} buys · ${trades.length - buys} sells` : '';
  $('#trades').innerHTML = trades.length ? `<table class="tt2"><thead><tr><th>Time</th><th>Side</th><th class="r">SOL</th><th class="r">Tokens</th><th class="r">Mcap</th><th>Wallet</th><th></th></tr></thead><tbody>${trades.slice(0, 30).map(t => `<tr><td>${ago(t.at)}</td><td><span class="sd ${t.side}">${t.side}</span></td><td class="r">${t.sol.toFixed(3)}</td><td class="r">${big(t.tokens)}</td><td class="r">${t.price ? (t.price * 1e9).toFixed(1) : '—'}</td><td><a href="https://solscan.io/account/${t.wallet}" target="_blank" rel="noreferrer">${short(t.wallet)}</a></td><td class="r"><a href="https://solscan.io/tx/${t.sig}" target="_blank" rel="noreferrer">tx ↗</a></td></tr>`).join('')}</tbody></table>` : `<div class="empty sm">No trades yet. The first buy will show up here within seconds.</div>`;
  $('#stats').innerHTML = `<h3><i data-lucide="activity"></i>Live <span class="upd">${c.last_seen ? 'updated ' + ago(c.last_seen) + ' ago' : ''}</span></h3>
    <div class="bigmc"><b>${mc.toFixed(1)}</b><span>SOL market cap</span></div>
    <div class="kv"><span>Curve progress</span><b>${c.migrated ? 'graduated' : pct + '%'}</b></div><div class="bar" style="margin:0 0 10px"><i style="width:${c.migrated ? 100 : pct}%"></i></div>
    <div class="kv"><span>SOL in the pool</span><b>${sol(c.quote_reserve_sol, 3)} / ${sol(c.to_graduate_sol, 0)}</b></div>
    <div class="kv"><span>Supply sold on the curve</span><b>${(sold * 100).toFixed(2)}%</b></div>
    <div class="kv"><span>Price</span><b>${c.price_sol ? c.price_sol.toExponential(3) + ' SOL' : '—'}</b></div>
    <div class="kv"><span>Volume</span><b>${sol(c.volume_sol, 3)}</b></div>
    <div class="kv"><span>Trading fees generated</span><b>${sol(c.fees_sol, 4)}</b></div>`;
  if (window.lucide) lucide.createIcons();
}
// The drawn curve, the path the price has travelled along it, and where it is now.
function chartSvg(c, hist) {
  const W = 800, H = 380, pad = 48, padB = 34, top = 24; const lo = S.config.startMcapSol, hi = hiOf(c);
  const X = f => pad + (W - 2 * pad) * f, Y = m => H - padB - (H - padB - top) * Math.max(0, Math.min(1.04, (m - lo) / (hi - lo)));
  const curve = c.points.map((v, i) => [X(i / (N - 1)), Y(lo + (hi - lo) * v)]);
  const d = 'M' + curve.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L');
  const sold = c.sold_pct || 0, mc = mcapOf(c); const lx = X(sold), ly = Y(mc);
  const trail = hist.filter(h => h[3] != null).map(h => [X(h[3]), Y(h[2] * 1e9)]);
  const ylabs = [0, .25, .5, .75, 1].map(v => `<text x="${pad - 8}" y="${(H - padB - (H - padB - top) * v).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-family="JetBrains Mono" font-size="10" fill="#9a9aa2">${Math.round(lo + (hi - lo) * v)}</text><line x1="${pad}" x2="${W - pad}" y1="${(H - padB - (H - padB - top) * v).toFixed(1)}" y2="${(H - padB - (H - padB - top) * v).toFixed(1)}" stroke="#ecebe5"/>`).join('');
  const xlabs = [0, 20, 40, 60, 80, 100].map(v => `<text x="${X(v / 100).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="#9a9aa2">${v}%</text>`).join('');
  const ducks = curve.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="#111114"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}"><defs><linearGradient id="cf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#111114" stop-opacity=".07"/><stop offset="1" stop-color="#111114" stop-opacity="0"/></linearGradient></defs>
    ${ylabs}${xlabs}
    <path d="${d} L${curve[N - 1][0]},${H - padB} L${curve[0][0]},${H - padB} Z" fill="url(#cf)"/><path d="${d}" fill="none" stroke="#111114" stroke-width="2" stroke-linejoin="round"/>${ducks}
    ${trail.length > 1 ? `<path d="M${trail.map(p => p.map(n => n.toFixed(1)).join(',')).join(' L')}" fill="none" stroke="#1f8a5a" stroke-width="2" stroke-opacity=".45" stroke-linejoin="round"/>` : ''}
    <line x1="${lx.toFixed(1)}" x2="${lx.toFixed(1)}" y1="${ly.toFixed(1)}" y2="${H - padB}" stroke="#1f8a5a" stroke-dasharray="3 4"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="14" fill="#1f8a5a" opacity=".15"><animate attributeName="r" values="8;18;8" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".3;0;.3" dur="2.4s" repeatCount="indefinite"/></circle>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="6.5" fill="#1f8a5a" stroke="#fff" stroke-width="2"/>
    <text x="${Math.min(W - pad, lx + 12).toFixed(1)}" y="${(ly - 12).toFixed(1)}" text-anchor="${lx > W - 160 ? 'end' : 'start'}" font-family="JetBrains Mono" font-size="11" fill="#1f8a5a">${mc.toFixed(1)} SOL · ${(sold * 100).toFixed(1)}%</text>
    <text x="${pad}" y="14" font-family="JetBrains Mono" font-size="10" fill="#9a9aa2">MCAP · SOL</text><text x="${W - pad}" y="14" text-anchor="end" font-family="JetBrains Mono" font-size="10" fill="#9a9aa2">SUPPLY SOLD →</text></svg>`;
}
function mcapSvg(c, hist, trades) {
  const W = 800, H = 200, pad = 48, padB = 28, top = 16;
  const firstT = Math.min(...trades.map(t => t.at), ...hist.map(h => h[0]), Date.now()); const ev = [[Math.max(c.created_at, firstT - 5 * 60e3), c.start_mcap_sol], ...hist.map(h => [h[0], h[2] * 1e9]), ...trades.filter(t => t.price).map(t => [t.at, t.price * 1e9])].filter(e => e[1] > 0).sort((a, b) => a[0] - b[0]);
  ev.push([Date.now(), mcapOf(c)]);
  if (ev.length < 3 && !trades.length) return `<div class="empty sm">Market cap history starts with the first trade.</div>`;
  const t0 = ev[0][0], t1 = Math.max(ev[ev.length - 1][0], t0 + 60000); const ms = ev.map(e => e[1]); let mn = Math.min(...ms), mx = Math.max(...ms); if (mx - mn < 1) { mn -= 1; mx += 1; } const padv = (mx - mn) * .1; mn -= padv; mx += padv;
  const X = t => pad + (W - 2 * pad) * (t - t0) / (t1 - t0), Y = m => H - padB - (H - padB - top) * (m - mn) / (mx - mn);
  let d = `M${X(ev[0][0]).toFixed(1)},${Y(ev[0][1]).toFixed(1)}`; for (let i = 1; i < ev.length; i++) d += ` L${X(ev[i][0]).toFixed(1)},${Y(ev[i - 1][1]).toFixed(1)} L${X(ev[i][0]).toFixed(1)},${Y(ev[i][1]).toFixed(1)}`;
  const mxs = Math.max(...trades.map(t => t.sol), .01);
  const marks = trades.filter(t => t.price).map(t => `<circle cx="${X(t.at).toFixed(1)}" cy="${Y(t.price * 1e9).toFixed(1)}" r="${(3 + 7 * Math.sqrt(t.sol / mxs)).toFixed(1)}" fill="${t.side === 'buy' ? '#1f8a5a' : '#c8443a'}" fill-opacity=".75" stroke="#fff"><title>${t.side} ${t.sol.toFixed(3)} SOL</title></circle>`).join('');
  const yl = [0, .5, 1].map(v => { const m = mn + (mx - mn) * v; return `<text x="${pad - 8}" y="${Y(m).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-family="JetBrains Mono" font-size="10" fill="#9a9aa2">${m.toFixed(1)}</text><line x1="${pad}" x2="${W - pad}" y1="${Y(m).toFixed(1)}" y2="${Y(m).toFixed(1)}" stroke="#ecebe5"/>`; }).join('');
  const fmt = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `<svg viewBox="0 0 ${W} ${H}">${yl}<path d="${d}" fill="none" stroke="#111114" stroke-width="1.6"/>${marks}<text x="${pad}" y="${H - 8}" font-family="JetBrains Mono" font-size="10" fill="#9a9aa2">${fmt(t0)}</text><text x="${W - pad}" y="${H - 8}" text-anchor="end" font-family="JetBrains Mono" font-size="10" fill="#9a9aa2">now</text></svg>`;
}

// ---------- the standard, as a set of drawing sheets ----------
async function standard() {
  const lo = S.config.startMcapSol, hi = S.config.maxMcapSol;
  const sample = PRESETS.hockey || Object.values(PRESETS)[0];
  let q = null; try { q = await (await fetch('/api/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ points: sample, taxStartBps: 9500 }) })).json(); } catch {}
  const sheets = [
    ['S-01', 'Origin', 'origin'], ['S-02', 'Anatomy of a curve', 'anatomy'], ['S-03', 'The math', 'math'],
    ['S-04', 'Sniper tax', 'tax'], ['S-05', 'Lifecycle', 'life'], ['S-06', 'Token & identity', 'identity'],
  ];
  const block = (n, t, rev = 'REV 2026-10') => `<div class="tb"><div><span>SHEET</span><b>${n}</b></div><div class="grow"><span>TITLE</span><b>${t}</b></div><div><span>STANDARD</span><b>SPL-16</b></div><div><span>REV</span><b>${rev.replace('REV ', '')}</b></div></div>`;
  app.innerHTML = `<div class="wrap std-wrap">
  <aside class="std-nav"><span class="std">THE SPLINE STANDARD</span><b>SPL-16</b><p>A specification for hand-drawn bonding curves on Solana, implemented on Meteora's Dynamic Bonding Curve.</p><ol>${sheets.map(([n, t, id]) => `<li><a href="#${id}"><span>${n}</span>${t}</a></li>`).join('')}</ol><a class="btn pri wide" href="/draw">Draw a curve</a></aside>
  <div class="std-body">
    <header class="std-hero"><span class="std">SPL-16 · DRAWING SET · 6 SHEETS</span><h1>The Spline Standard</h1><p>How a line drawn by hand becomes a market that can't be changed. Each sheet below covers one part of the system, with the numbers the launchpad actually uses.</p></header>

    <section class="sheet" id="origin"><div class="sh-in">
      <div class="sh-grid">
        <figure class="ph"><img src="/img/loftsman.jpg" alt="Loftsman with a frame template"><figcaption>Loftsman, 1942. Library of Congress, FSA/OWI.</figcaption></figure>
        <div class="notes"><h2>Origin</h2>
          <p>A spline is a long, thin, flexible strip — wood, later plastic — used to draw smooth curves too large or too subtle for a French curve. It's held on the drawing by lead weights called <b>ducks</b>, each with a hooked nose that pins the strip at one point.</p>
          <p>The draftsman decides where the ducks go. The strip, resisting the bend, settles into the smoothest line that passes through all of them. Ship hulls were faired this way for centuries; aircraft fuselages were lofted this way into the 1960s. The mathematical spline used in every CAD program today is named after the tool.</p>
          <ol class="callouts"><li>Station — a fixed position along the length. SPL-16 has 16, along the supply axis.</li><li>Duck — the weight that sets the height at a station. Here, the price.</li><li>Fairing — removing bumps. Here, removing any dip: price only goes up.</li></ol>
        </div>
      </div>
      <figure class="wide"><img src="/img/lines-sheet.jpg" alt="Lines drawing sheet, Blanchard Jr. Knockabout"><figcaption>Lines sheet with table of offsets, stations 1–9. HAER WA-181, Library of Congress. A bonding curve is a table of offsets for a market.</figcaption></figure>
    </div>${block('S-01', 'ORIGIN')}</section>

    <section class="sheet" id="anatomy"><div class="sh-in">
      <h2>Anatomy of a curve</h2><p class="lede">The sample below is the "hockey" preset, quoted live against the DBC SDK. Every SPL-16 curve has the same parts.</p>
      <div class="anat">${anatomySvg(sample, q)}</div>
      <div class="legend3"><div><b>A · Stations</b><p>16 points, evenly spaced over the supply sold on the curve: 0%, 6.67%, 13.3% … 100%.</p></div><div><b>B · Heights</b><p>Each height is a market cap between ${lo} SOL (bottom of the board) and ${hi} SOL (top). Price = mcap ÷ 1,000,000,000.</p></div><div><b>C · Segments</b><p>15 constant-product segments, one between each pair of points. Each sells the same 1/15 of curve supply.</p></div><div><b>D · Threshold</b><p>The SOL that buying out every segment takes${q ? ` — ${q.toGraduateSol} SOL for this curve` : ''}. Reaching it triggers migration.</p></div></div>
    </div>${block('S-02', 'ANATOMY')}</section>

    <section class="sheet" id="math"><div class="sh-in">
      <h2>The math</h2><p class="lede">Meteora DBC prices a pool by √price, stored as a Q64.64 fixed-point number. Within a segment it behaves like a constant-product pool with liquidity <code>L</code>.</p>
      <div class="eqs">
        <div class="eq"><span>1 · height → price</span><code>pᵢ = (${lo} + (${hi} − ${lo}) · hᵢ) / 10⁹ &nbsp;&nbsp; hᵢ = max(hᵢ, hᵢ₋₁)</code><p>Heights are made non-decreasing before anything else. A dip in the drawing becomes a flat run.</p></div>
        <div class="eq"><span>2 · price → sqrtPrice</span><code>√Pᵢ = √(pᵢ · 10^(9−6)) · 2⁶⁴</code><p>SOL has 9 decimals, the token 6. The SDK's <code>createSqrtPrices</code> does this conversion.</p></div>
        <div class="eq"><span>3 · tokens sold in segment i</span><code>Δxᵢ = Lᵢ · (1/√Pᵢ − 1/√Pᵢ₊₁)</code><p>We want every Δxᵢ equal, so the drawing's x-axis really is "share of supply sold".</p></div>
        <div class="eq"><span>4 · solve for liquidity</span><code>Lᵢ ∝ 1 / (1/√Pᵢ − 1/√Pᵢ₊₁)</code><p>Passed to <code>buildCurveWithCustomSqrtPrices</code> as liquidity weights, normalised to the largest.</p></div>
        <div class="eq"><span>5 · SOL raised in segment i</span><code>Δyᵢ = Lᵢ · (√Pᵢ₊₁ − √Pᵢ)</code><p>Steep segments cost more SOL for the same tokens. Flat segments are cheap.</p></div>
        <div class="eq"><span>6 · graduation threshold</span><code>T = Σ Δyᵢ &nbsp;&nbsp;(i = 1…15)</code><p>Written to the config as <code>migrationQuoteThreshold</code>. Different drawing, different threshold.</p></div>
      </div>
    </div>${block('S-03', 'THE MATH')}</section>

    <section class="sheet" id="tax"><div class="sh-in">
      <h2>Sniper tax</h2><p class="lede">Optional per coin. The creator draws the decay; it's fitted to DBC's fee scheduler on the base fee.</p>
      <div class="sh-grid r"><div class="anat">${taxSvg()}</div>
        <div class="notes"><table class="t2"><tr><td>start</td><td>95% (9,500 bps)</td></tr><tr><td>floor</td><td>1% (100 bps)</td></tr><tr><td>schedule</td><td>drawn by the creator, fitted to linear or exponential</td></tr><tr><td>duration</td><td>1–20 min, in 10 s steps</td></tr><tr><td>default</td><td>exponential · 10 min</td></tr><tr><td>at 1 · 3 · 5 min</td><td>${taxAt(60).toFixed(1)}% · ${taxAt(180).toFixed(1)}% · ${taxAt(300).toFixed(1)}% (default)</td></tr></table>
        <p>The fee is charged in SOL and goes to the pool's fee accounts like any trading fee. The scheduler can only decrease the fee, so a coin can't raise its tax after launch. Coins without the tax trade at a flat 1% from the first block.</p></div></div>
    </div>${block('S-04', 'SNIPER TAX')}</section>

    <section class="sheet" id="life"><div class="sh-in">
      <h2>Lifecycle</h2><p class="lede">Three accounts, one launch, one migration.</p>
      <div class="anat">${lifeSvg()}</div>
      <div class="legend3"><div><b>Launch</b><p>One wallet signature. Creates the DBC config (your curve), the mint, and the pool. Optionally includes the creator's first buy.</p></div><div><b>On the curve</b><p>Buys and sells settle against the pool. Fees: 1%, split 50/50 creator / platform after Meteora's protocol share.</p></div><div><b>Graduation</b><p>At the threshold, the pool migrates to Meteora DAMM v2 with a 1% pool fee. LP is permanently locked, 50% creator / 50% platform.</p></div></div>
    </div>${block('S-05', 'LIFECYCLE')}</section>

    <section class="sheet" id="identity"><div class="sh-in">
      <h2>Token &amp; identity</h2>
      <div class="sh-grid">
        <div class="notes"><table class="t2"><tr><td>program</td><td>SPL Token (original program)</td></tr><tr><td>supply</td><td>1,000,000,000 · 6 decimals</td></tr><tr><td>mint authority</td><td>none — revoked at creation</td></tr><tr><td>metadata</td><td>Metaplex, immutable</td></tr><tr><td>quote</td><td>SOL</td></tr><tr><td>launch mcap</td><td>${lo} SOL</td></tr><tr><td>board ceiling</td><td>${hi} SOL</td></tr><tr><td>post-graduation pool</td><td>Meteora DAMM v2</td></tr></table>
        <p>SPL-16 is not a new token program. Coins are ordinary SPL tokens and work in every wallet, explorer and aggregator. What's standard is the curve and how it's recorded.</p></div>
        <pre class="json">{
  "name": "Ledge",
  "symbol": "LEDGE",
  "image": "ipfs://…/logo.png",
  "attributes": [
    { "trait_type": "standard", "value": "SPL-16" },
    { "trait_type": "shape", "value": "ramp" },
    { "trait_type": "points", "value": 16 },
    { "trait_type": "curve",
      "value": "0,0.02,0.04,…,1" }
  ],
  "properties": {
    "curve_image": "ipfs://…/curve.png"
  }
}</pre>
      </div>
      <p class="lede" style="margin-top:18px">Any client can redraw the curve from the mint alone: read the metadata, take the 16 heights, plot them against 0–100% of supply.</p>
    </div>${block('S-06', 'TOKEN & IDENTITY')}</section>
  </div></div>`;
}
function anatomySvg(P, q) {
  const W = 900, H = 420, pad = 64, padB = 50, top = 30; const lo = S.config.startMcapSol, hi = S.config.maxMcapSol;
  const X = i => pad + (W - 2 * pad) * i / (N - 1), Y = v => H - padB - (H - padB - top) * v;
  const pts = P.map((v, i) => [X(i), Y(v)]);
  let s = ''; for (let i = 0; i < N - 1; i++) s += `<rect x="${pts[i][0]}" y="${pts[i + 1][1]}" width="${pts[i + 1][0] - pts[i][0] - 2}" height="${H - padB - pts[i + 1][1]}" fill="#2f4a6d" fill-opacity="${i % 2 ? .05 : .09}"/>`;
  const line = 'M' + pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' L');
  const st = pts.map((p, i) => `<text x="${p[0]}" y="${top - 12}" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="#2f4a6d">${i + 1}</text><line x1="${p[0]}" x2="${p[0]}" y1="${top - 6}" y2="${H - padB}" stroke="#2f4a6d" stroke-opacity=".15" stroke-dasharray="2 4"/>`).join('');
  const ducks = pts.map(p => `<g transform="translate(${p[0] - 11},${p[1] - 1}) scale(.5)" fill="#111114" stroke="#111114"><path d="M22 2 L22 9" stroke-width="2.4" stroke-linecap="round"/><path d="M4 26 C4 15 13 9 23 9 C31 9 37 13 40 18 C41.5 21 40 26 36 26 Z" stroke="none"/></g>`).join('');
  const yl = [0, .5, 1].map(v => `<text x="${pad - 10}" y="${Y(v)}" text-anchor="end" dominant-baseline="middle" font-family="JetBrains Mono" font-size="10" fill="#56565e">${Math.round(lo + (hi - lo) * v)}</text>`).join('');
  const cum = q?.cumSol || []; const seg = 9;
  const tag = (x, y, t, a = 'start') => `<text x="${x}" y="${y}" text-anchor="${a}" font-family="JetBrains Mono" font-size="11" fill="#111114">${t}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}">${s}${st}<line x1="${pad}" x2="${W - pad}" y1="${H - padB}" y2="${H - padB}" stroke="#2f4a6d"/>${yl}
    <path d="${line}" fill="none" stroke="#e9dcc0" stroke-width="6" stroke-linejoin="round"/><path d="${line}" fill="none" stroke="#111114" stroke-width="1.6" stroke-linejoin="round"/>${ducks}
    <text x="${pad - 10}" y="${top - 12}" text-anchor="end" font-family="JetBrains Mono" font-size="9" fill="#9a9aa2">STATION</text>
    <text x="${pad - 52}" y="${(H - padB + top) / 2}" transform="rotate(-90 ${pad - 52} ${(H - padB + top) / 2})" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="#56565e">MARKET CAP · SOL</text>
    <text x="${W / 2}" y="${H - 14}" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="#56565e">SUPPLY SOLD ON THE CURVE · 0 → 100%</text>
    <circle cx="${pts[3][0]}" cy="${pts[3][1] - 40}" r="11" fill="#fff" stroke="#111114"/>${tag(pts[3][0], pts[3][1] - 36, 'A', 'middle')}<line x1="${pts[3][0]}" x2="${pts[3][0]}" y1="${pts[3][1] - 29}" y2="${pts[3][1] - 8}" stroke="#111114"/>
    <circle cx="${pts[12][0] - 36}" cy="${pts[12][1]}" r="11" fill="#fff" stroke="#111114"/>${tag(pts[12][0] - 36, pts[12][1] + 4, 'B', 'middle')}<line x1="${pts[12][0] - 25}" x2="${pts[12][0] - 8}" y1="${pts[12][1]}" y2="${pts[12][1]}" stroke="#111114"/>
    <circle cx="${(pts[seg][0] + pts[seg + 1][0]) / 2}" cy="${H - padB - 22}" r="11" fill="#fff" stroke="#111114"/>${tag((pts[seg][0] + pts[seg + 1][0]) / 2, H - padB - 18, 'C', 'middle')}
    ${cum.length ? `<text x="${(pts[seg][0] + pts[seg + 1][0]) / 2}" y="${H - padB - 42}" text-anchor="middle" font-family="JetBrains Mono" font-size="9" fill="#2f4a6d">${(cum[seg] - cum[seg - 1]).toFixed(2)} SOL</text>` : ''}
    <circle cx="${pts[15][0]}" cy="${pts[15][1] - 30}" r="11" fill="#fff" stroke="#1f8a5a"/><text x="${pts[15][0]}" y="${pts[15][1] - 26}" text-anchor="middle" font-family="JetBrains Mono" font-size="11" fill="#1f8a5a">D</text>
    ${q ? `<text x="${pts[15][0] - 18}" y="${pts[15][1] - 26}" text-anchor="end" font-family="JetBrains Mono" font-size="10" fill="#1f8a5a">T = ${q.toGraduateSol} SOL</text>` : ''}</svg>`;
}
function taxSvg() {
  const W = 520, H = 260, pad = 44, padB = 34, top = 16; const X = s => pad + (W - 2 * pad) * s / 600, Y = f => H - padB - (H - padB - top) * f / 95;
  let d = `M${X(0)},${Y(95)}`; for (let s = 10; s <= 600; s += 10) d += ` L${X(s)},${Y(taxAt(s - 10))} L${X(s)},${Y(taxAt(s))}`;
  const yl = [95, 50, 25, 1].map(v => `<text x="${pad - 8}" y="${Y(v)}" text-anchor="end" dominant-baseline="middle" font-family="JetBrains Mono" font-size="10" fill="#56565e">${v}%</text><line x1="${pad}" x2="${W - pad}" y1="${Y(v)}" y2="${Y(v)}" stroke="#ecebe5"/>`).join('');
  const xl = [0, 2, 4, 6, 8, 10].map(m => `<text x="${X(m * 60)}" y="${H - 12}" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="#56565e">${m}m</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}">${yl}${xl}<path d="${d} L${X(600)},${Y(0)} L${X(0)},${Y(0)} Z" fill="#c8443a" fill-opacity=".08"/><path d="${d}" fill="none" stroke="#c8443a" stroke-width="1.8"/></svg>`;
}
function lifeSvg() {
  const box = (x, y, w, t, lines, col = '#111114') => `<rect x="${x}" y="${y}" width="${w}" height="${30 + lines.length * 16}" rx="6" fill="#fff" stroke="${col}"/><text x="${x + 12}" y="${y + 20}" font-family="JetBrains Mono" font-size="11" font-weight="500" fill="${col}">${t}</text>${lines.map((l, i) => `<text x="${x + 12}" y="${y + 40 + i * 16}" font-family="JetBrains Mono" font-size="10" fill="#56565e">${l}</text>`).join('')}`;
  const arr = (x1, y1, x2, y2, t) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#2f4a6d" marker-end="url(#ah)"/>${t ? `<text x="${(x1 + x2) / 2}" y="${y1 - 8}" text-anchor="middle" font-family="JetBrains Mono" font-size="9.5" fill="#2f4a6d">${t}</text>` : ''}`;
  return `<svg viewBox="0 0 900 230"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#2f4a6d"/></marker></defs>
    ${box(10, 40, 170, 'creator wallet', ['draws 16 points', 'signs one launch'])}
    ${arr(180, 70, 236, 70, 'launch tx')}
    ${box(240, 10, 190, 'DBC config', ['sqrtPrices[16]', 'liquidity[15]', 'fees · migration'])}
    ${box(240, 120, 190, 'DBC pool + mint', ['1B SPL tokens', 'SOL vault', 'fees: creator / platform'])}
    <line x1="335" y1="88" x2="335" y2="120" stroke="#2f4a6d" stroke-dasharray="3 3"/>
    ${arr(430, 160, 520, 160, 'buys & sells')}
    ${box(524, 120, 160, 'on the curve', ['price follows', 'your drawing'])}
    ${arr(684, 160, 726, 160, 'T reached')}
    ${box(730, 110, 160, 'DAMM v2 pool', ['1% pool fee', 'LP locked forever', '50 / 50 positions'], '#1f8a5a')}</svg>`;
}
function notFound() { app.innerHTML = `<div class="wrap"><div class="card empty"><svg class="e-s" viewBox="0 0 100 100"><use href="#m16"/></svg><b>Nothing here.</b><a href="/">Back to curves</a></div></div>`; }

const CRUMB = { '/': 'Home', '/coins': 'Home', '/draw': 'Draw', '/lab': 'Draw', '/mine': 'Yours', '/standard': 'Standard' };
async function render() {
  clearInterval(LIVE);
  await state(); const r = location.pathname;
  document.querySelectorAll('.nb-nav a[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === '/' ? (r === '/' || r === '/coins') : r.startsWith(a.dataset.r) || (a.dataset.r === '/draw' && r === '/lab')));
  const cname = r.startsWith('/c/') ? (S.coins.find(c => c.mint === r.slice(3))?.ticker ? '$' + S.coins.find(c => c.mint === r.slice(3)).ticker : 'Coin') : (CRUMB[r] || '—');
  document.title = r === '/' ? 'SPL-16' : `${cname} · SPL-16`;
  if (r === '/' || r === '/coins') home(); else if (r === '/draw' || r === '/lab') drawPage(); else if (r === '/mine') await mine(); else if (r === '/standard') await standard(); else if (r.startsWith('/c/')) await coinPage(r.slice(3)); else notFound();
  if (window.lucide) lucide.createIcons();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
{ const inner = '<path class="s" d="M19.90,83.50 L21.14,83.63 L22.37,83.74 L23.57,83.83 L24.74,83.89 L25.87,83.93 L26.98,83.94 L28.07,83.92 L29.12,83.87 L30.16,83.79 L31.16,83.69 L32.15,83.56 L33.11,83.40 L34.05,83.20 L34.96,82.98 L35.86,82.73 L36.73,82.45 L37.59,82.14 L38.42,81.80 L39.23,81.43 L40.01,81.03 L40.78,80.60 L41.52,80.14 L42.24,79.66 L42.93,79.14 L43.61,78.60 L44.26,78.04 L44.88,77.45 L45.48,76.84 L46.06,76.21 L46.61,75.56 L47.14,74.89 L47.65,74.20 L48.13,73.50 L48.59,72.78 L49.03,72.05 L49.45,71.31 L49.85,70.55 L50.23,69.78 L50.59,69.00 L50.93,68.21 L51.26,67.42 L51.57,66.61 L51.86,65.80 L52.14,64.99 L52.41,64.17 L52.66,63.34 L52.90,62.51 L53.13,61.67 L53.34,60.83 L53.55,59.99 L53.75,59.15 L53.93,58.30 L54.11,57.46 L54.28,56.61 L54.45,55.77 L54.60,54.92 L54.76,54.08 L54.90,53.24 L55.05,52.40 L55.18,51.56 L55.32,50.73 L55.45,49.90 L55.58,49.07 L55.71,48.25 L55.84,47.43 L55.97,46.62 L56.10,45.82 L56.23,45.02 L56.37,44.23 L56.50,43.45 L56.64,42.67 L56.78,41.91 L56.93,41.15 L57.08,40.40 L57.23,39.66 L57.39,38.93 L57.56,38.21 L57.73,37.50 L57.91,36.81 L58.10,36.12 L58.30,35.44 L58.50,34.78 L58.72,34.13 L58.94,33.49 L59.17,32.86 L59.42,32.25 L59.68,31.64 L59.95,31.05 L60.23,30.47 L60.53,29.90 L60.84,29.34 L61.17,28.80 L61.52,28.26 L61.88,27.74 L62.26,27.22 L62.67,26.72 L63.09,26.23 L63.55,25.75 L64.02,25.28 L64.52,24.82 L65.05,24.38 L65.61,23.95 L66.21,23.53 L66.83,23.12 L67.49,22.73 L68.18,22.36 L68.91,22.00 L69.67,21.66 L70.48,21.35 L71.32,21.05 L72.20,20.77 L73.12,20.52 L74.08,20.29 L75.08,20.09 L76.12,19.91 L77.20,19.76 L78.32,19.65 L79.49,19.56 L80.69,19.51 L81.96,19.50 L82.04,16.50 L80.74,16.42 L79.46,16.36 L78.22,16.32 L77.00,16.30 L75.82,16.32 L74.66,16.36 L73.53,16.42 L72.43,16.51 L71.36,16.63 L70.31,16.78 L69.28,16.96 L68.28,17.16 L67.31,17.40 L66.36,17.66 L65.43,17.95 L64.52,18.27 L63.64,18.61 L62.78,18.99 L61.94,19.39 L61.12,19.82 L60.33,20.28 L59.56,20.77 L58.82,21.28 L58.10,21.82 L57.40,22.38 L56.73,22.97 L56.08,23.58 L55.46,24.21 L54.86,24.87 L54.28,25.54 L53.73,26.23 L53.20,26.93 L52.70,27.66 L52.21,28.39 L51.75,29.14 L51.31,29.91 L50.89,30.68 L50.49,31.47 L50.11,32.26 L49.75,33.07 L49.41,33.88 L49.08,34.70 L48.77,35.52 L48.48,36.35 L48.20,37.19 L47.93,38.03 L47.68,38.88 L47.44,39.73 L47.22,40.58 L47.00,41.43 L46.79,42.28 L46.60,43.14 L46.41,43.99 L46.24,44.85 L46.07,45.70 L45.91,46.55 L45.75,47.40 L45.60,48.25 L45.46,49.10 L45.32,49.94 L45.18,50.78 L45.05,51.61 L44.92,52.44 L44.79,53.26 L44.66,54.08 L44.54,54.88 L44.41,55.69 L44.29,56.48 L44.16,57.27 L44.03,58.05 L43.90,58.82 L43.77,59.58 L43.63,60.33 L43.49,61.07 L43.35,61.80 L43.20,62.51 L43.05,63.22 L42.89,63.91 L42.72,64.60 L42.55,65.27 L42.37,65.92 L42.18,66.57 L41.98,67.20 L41.78,67.82 L41.56,68.42 L41.34,69.02 L41.10,69.59 L40.86,70.16 L40.60,70.71 L40.33,71.25 L40.04,71.78 L39.74,72.29 L39.43,72.80 L39.10,73.29 L38.75,73.77 L38.38,74.23 L37.99,74.69 L37.57,75.13 L37.14,75.57 L36.67,75.99 L36.18,76.40 L35.66,76.79 L35.11,77.18 L34.53,77.55 L33.91,77.90 L33.26,78.24 L32.58,78.56 L31.86,78.86 L31.10,79.14 L30.30,79.39 L29.46,79.63 L28.58,79.84 L27.67,80.03 L26.71,80.19 L25.71,80.32 L24.68,80.43 L23.60,80.50 L22.48,80.54 L21.32,80.54 L20.10,80.50Z" fill="currentColor"/><circle class="w" cx="20" cy="82" r="5.5" fill="currentColor"/><circle class="w" cx="82" cy="18" r="5.5" fill="currentColor"/>'; document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute"><symbol id="m16" viewBox="0 0 100 100">${inner.replace(/ pathLength="1"/, '')}</symbol></svg>`); $('#mark').innerHTML = `<svg viewBox="0 0 100 100">${inner}</svg>`; const m2 = $('#mark2'); if (m2) m2.innerHTML = `<svg viewBox="0 0 100 100"><use href="#m16"/></svg>`; const b = $('.nb-brand'); const ink = () => { b.classList.remove('ink'); void b.offsetWidth; b.classList.add('ink'); }; ink(); b.addEventListener('mouseenter', ink); }
render();
