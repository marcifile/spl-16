// spline frontend. Routes: / , /coins , /lab , /c/:mint , /standard
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = a => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '—');
const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? `${s | 0}s` : s < 3600 ? `${(s / 60) | 0}m` : s < 86400 ? `${(s / 3600) | 0}h` : `${(s / 86400) | 0}d`; };
const sol = (n, d = 1) => `${Number(n || 0).toFixed(d)} SOL`;
const N = 16;
let S = null, wallet = null;

// ---------- glyphs ----------
function curvePath(points, W, H, pad) {
  const pts = points.map((v, i) => [pad + (W - 2 * pad) * i / (N - 1), H - pad - (H - 2 * pad) * v]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2; d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`; }
  return { d, pts };
}
const glyph = (points, w = 40, h = 24) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${curvePath(points, w, h, 3).d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const iconSvg = points => { const s = 200, { d, pts } = curvePath(points, s, s, 32), e = pts[pts.length - 1]; return `<svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}"><rect width="${s}" height="${s}" fill="#f4f2ec"/><path d="${d}" fill="none" stroke="#111114" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${e[0].toFixed(1)}" cy="${e[1].toFixed(1)}" r="5.6" fill="#f4f2ec"/></svg>`; };

// ---------- wallet (Phantom / any window.solana) ----------
async function connect() {
  const p = window.solana || window.phantom?.solana; if (!p) { alert('No Solana wallet found. Install Phantom.'); return null; }
  const r = await p.connect(); wallet = r.publicKey.toString(); paintWallet(); return wallet;
}
function paintWallet() { const b = $('#wallet span'); b.textContent = wallet ? short(wallet) : 'Connect'; }
$('#wallet').onclick = async () => { if (wallet) { try { await (window.solana || window.phantom?.solana).disconnect(); } catch {} wallet = null; paintWallet(); } else connect(); };
(window.solana || window.phantom?.solana)?.connect?.({ onlyIfTrusted: true }).then(r => { wallet = r.publicKey.toString(); paintWallet(); }).catch(() => {});

async function state() { S = await (await fetch('/api/state')).json(); return S; }

// ---------- home ----------
function home() {
  const { coins, totals } = S; const latest = coins.slice(0, 6);
  app.innerHTML = `<div class="wrap">
  <section class="hero">
    <div>
      <span class="std">SPL-16 · THE SPLINE STANDARD</span>
      <h1>Draw the curve.<br><em>Launch the coin.</em></h1>
      <p>Every coin here trades on a bonding curve its creator drew by hand. Up to sixteen price points, any shape — written into the pool config on Meteora and enforced on chain from the first buy.</p>
      <div class="cta"><a class="btn pri big" href="/lab"><i data-lucide="pen-tool"></i>Draw a coin</a><a class="btn big" href="/standard">Read the standard</a></div>
    </div>
    <div class="art"><svg viewBox="0 0 1000 561"><use href="#swan"/></svg><span class="cap">one line · sixteen points · on chain</span></div>
  </section>
  <section class="stats">
    <div class="card stat"><span>Coins drawn</span><b>${totals.coins}</b></div>
    <div class="card stat"><span>Graduated</span><b>${totals.graduated}</b></div>
    <div class="card stat"><span>SOL on curves</span><b>${Number(totals.tvl).toFixed(1)}</b></div>
    <div class="card stat"><span>Fees to creators</span><b>${Number(totals.fees).toFixed(2)}</b></div>
  </section>
  <div class="ch" style="border:0;padding:0 0 14px"><h2 style="font-family:var(--serif);font-size:22px;font-weight:500">Latest curves</h2><a href="/coins" class="xl">All coins →</a></div>
  ${latest.length ? `<div class="grid">${latest.map(coinCard).join('')}</div>` : `<div class="card empty"><b>No coins yet.</b>The first curve drawn on spline shows up here.</div>`}
  <section class="how">
    <div class="card"><i data-lucide="git-commit-horizontal"></i><b>It's the real curve</b><p>Meteora's bonding curve takes up to 16 price points. Your drawing is those points. The coin trades on exactly that shape — no simulation.</p></div>
    <div class="card"><i data-lucide="trending-up"></i><b>Price only goes up</b><p>A bonding curve can't dip: later buyers always pay at least what earlier buyers did. Draw a dip and it flattens to the last high.</p></div>
    <div class="card"><i data-lucide="fingerprint"></i><b>Your icon is your curve</b><p>Every coin's mark is its own sixteen points drawn as one stroke, so a cliff and a ramp look different everywhere.</p></div>
  </section></div>`;
}
function coinCard(c) {
  const pct = Math.round((c.progress || 0) * 100);
  return `<a class="card coin" href="/c/${c.mint}"><div class="ic">${iconSvg(c.points)}</div><div>
    <div class="t">${esc(c.name)}</div><div class="tk">$${esc(c.ticker)} · ${esc(c.shape)} · ${ago(c.created_at)} ago</div>
    <div class="m"><span>curve <b>${sol(c.quote_reserve_sol)}</b> / ${sol(c.to_graduate_sol, 0)}</span>${c.tax_start_bps ? `<span class="tag">tax</span>` : ''}${c.migrated ? `<span class="tag good">graduated</span>` : ''}</div>
    <div class="bar"><i style="width:${c.migrated ? 100 : pct}%"></i></div></div></a>`;
}
function coins() {
  app.innerHTML = `<div class="wrap"><div class="ch" style="border:0;padding:0 0 18px"><h2 style="font-family:var(--serif);font-size:30px;font-weight:500">All coins <span class="sub">${S.coins.length}</span></h2><a class="btn pri" href="/lab">Draw a coin</a></div>
  ${S.coins.length ? `<div class="grid">${S.coins.map(coinCard).join('')}</div>` : `<div class="card empty"><b>No coins yet.</b><a href="/lab">Draw the first one.</a></div>`}</div>`;
}

// ---------- lab ----------
async function lab() {
  const presets = await (await fetch('/api/presets')).json();
  app.innerHTML = `<div class="wrap lab">
  <div class="head"><div><h1>Draw your curve.</h1><p>The line you draw becomes the bonding curve your coin trades on. Up to 16 points. One rule: price can only go up.</p></div>
    <div class="steps"><span class="on" id="st1"><b>1</b>Draw</span><span id="st2"><b>2</b>Sniper tax</span><span id="st3"><b>3</b>Name it</span><span id="st4"><b>4</b>Launch</span></div></div>
  <div class="card">
    <div class="ch"><h2>Price curve <span class="sub">price vs. % of supply sold</span></h2><span class="rule" id="rule"><i></i>price only goes up — dips are flattened</span></div>
    <div class="stage"><div class="canvas" id="cv"><div class="grid-bg"></div>
      <svg id="svg" viewBox="0 0 1000 560" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#111114" stop-opacity=".07"/><stop offset="1" stop-color="#111114" stop-opacity="0"/></linearGradient></defs>
        <path id="area" fill="url(#fill)"/><path id="raw" fill="none" stroke="#9a9aa3" stroke-width="1.5" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/><path id="line" fill="none" stroke="#111114" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><g id="fixes"></g><g id="dots"></g></svg>
      <div class="hint" id="hint"><b>Click and drag, left to right</b>sketch any shape — it snaps to 16 points and the numbers update as you go</div>
      <div class="axis" style="left:12px;top:10px">↑ price</div><div class="axis" style="left:12px;bottom:10px">0% sold</div><div class="axis" style="right:12px;bottom:10px">100% of curve · graduation →</div>
      <div id="anns"></div><div class="toast" id="toast">price can't go down — that part was flattened</div></div></div>
    <div class="legend"><span><span class="sw"></span>your curve (16 points)</span><span><span class="sw dash"></span>raw stroke</span><span><span class="sw" style="background:var(--bad)"></span>flattened (went down)</span></div>
  </div>
  <div class="side">
    <div class="card"><div class="sec"><h3><i data-lucide="shapes"></i>Start from a shape</h3><div class="shapes" id="shapes">${Object.keys(presets).map(k => `<div class="shape" data-s="${k}">${glyph(presets[k], 34, 20)}<i>${k}</i></div>`).join('')}</div><p class="note" style="margin-top:26px">Pick one, then draw over it. Or just draw.</p></div></div>
    <div class="card"><div class="sec"><h3><i data-lucide="calculator"></i>What this curve means</h3>
      <div class="kv"><span>SOL to graduate<small>buys needed to migrate to the DEX</small></span><b id="k-grad">—</b></div>
      <div class="kv"><span>Cost of the first 10%<small>what the earliest buyers pay, total</small></span><b id="k-first">—</b></div>
      <div class="kv"><span>1 SOL at launch buys<small>share of total supply</small></span><b id="k-buy">—</b></div>
      <div class="kv"><span>Launch → graduation mcap<small>in SOL</small></span><b id="k-mcap">—</b></div>
      <div class="kv"><span>Shape</span><b id="k-shape">—</b></div>
      <div class="kv"><span>Sniper tax</span><b id="k-tax2">off</b></div>
      <p class="note" id="qnote">Numbers come from the real Meteora curve math for this exact drawing.</p></div></div>
    <div class="card tax off" id="taxcard"><div class="sec"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0"><i data-lucide="shield"></i>Sniper tax <span style="font-weight:400;color:var(--ink3);text-transform:none;letter-spacing:0">· optional</span></h3><label class="switch" id="taxsw"><i></i>off</label></div>
      <div class="body"><p class="note" style="margin:0 0 10px">A buy fee for the first 10 minutes. Starts at 95% and can only decrease — Meteora's fee scheduler only decays. Draw how fast it drops.</p>
      <div class="canvas" id="taxbar"><div class="grid-bg" style="background-size:10% 25%"></div><svg id="taxsvg" viewBox="0 0 400 100" preserveAspectRatio="none"><path id="taxarea" fill="#c8443a" fill-opacity=".08"/><path id="taxline" fill="none" stroke="#c8443a" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="axis" style="left:8px;top:6px">95%</div><div class="axis" style="left:8px;bottom:6px">1%</div><div class="axis" style="right:8px;bottom:6px">10 min</div></div>
      <div class="kv" style="margin-top:12px"><span>Fee at launch → after 10 min</span><b id="k-tax">95% → 1%</b></div></div></div></div>
    <div class="card"><div class="sec"><h3><i data-lucide="tag"></i>Name it</h3>
      <div class="field"><label>Name</label><input id="nm" placeholder="e.g. ledge" maxlength="32"></div>
      <div class="field"><label>Ticker</label><input id="tk" placeholder="LEDGE" maxlength="10" style="text-transform:uppercase"></div>
      <div class="field"><label>Description <span style="font-weight:400;color:var(--ink3)">· optional</span></label><textarea id="ds" maxlength="300" placeholder="what is this coin"></textarea></div>
      <div class="field"><label>Your first buy <span style="font-weight:400;color:var(--ink3)">· SOL, optional</span></label><input id="fb" type="number" min="0" step="0.05" placeholder="0"></div>
      <div class="preview"><div class="ic" id="pv"></div><small>Your coin's icon is its curve. This is what shows in wallets and on DEX screeners.</small></div>
      <div class="row"><button class="btn pri" id="launch" disabled>Launch this curve</button><button class="btn" id="clear">Clear</button></div>
      <div class="err" id="err"></div>
      <p class="note">Launching creates the pool config and the coin on Meteora DBC in one transaction, signed by your wallet. The curve is immutable afterwards — by you or by us. Network fees ~0.03 SOL.</p>
      <div class="pts" id="pts"></div></div></div>
  </div></div>`;
  labInit(presets);
}
function labInit(presets) {
  const W = 1000, H = 560, PAD = 36; const cv = $('#cv'); let raw = [], pts = null, fixed = [], drawing = false, toastT = null, quoteT = null, taxOn = false, taxEnd = 1;
  const toSvg = e => { const r = cv.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: (t.clientX - r.left) / r.width * W, y: (t.clientY - r.top) / r.height * H }; };
  const price = p => (H - PAD - p.y) / (H - 2 * PAD);
  function snap(samples) { const xs = [], ys = [], fx = []; for (let i = 0; i < N; i++) { const x = PAD + (W - 2 * PAD) * i / (N - 1); xs.push(x); let best = null, bd = 1e9; for (const p of samples) { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = p; } } ys.push(best ? best.y : H - PAD); } for (let i = 1; i < N; i++) { if (ys[i] > ys[i - 1] + .5) fx.push(i); ys[i] = Math.min(ys[i], ys[i - 1]); } for (let i = 0; i < N; i++) ys[i] = Math.max(PAD, Math.min(H - PAD, ys[i])); if (ys[N - 1] >= ys[0] - 8) ys[N - 1] = Math.max(PAD, ys[0] - 60); fixed = fx; return xs.map((x, i) => ({ x, y: ys[i] })); }
  function fromPoints(P) { raw = []; fixed = []; pts = P.map((v, i) => ({ x: PAD + (W - 2 * PAD) * i / (N - 1), y: H - PAD - (H - 2 * PAD) * v })); render(true); }
  function set(id, v) { const el = $(id); if (!el) return; if (el.textContent !== v) { el.textContent = v; el.classList.add('hot'); setTimeout(() => el.classList.remove('hot'), 250); } }
  function render(final) {
    $('#raw').setAttribute('d', raw.length > 1 ? 'M' + raw.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L') : '');
    const rule = $('#rule');
    if (!pts) { ['#line', '#area'].forEach(i => $(i).setAttribute('d', '')); $('#dots').innerHTML = ''; $('#fixes').innerHTML = ''; $('#anns').innerHTML = ''; $('#hint').classList.remove('off'); $('#launch').disabled = true; rule.className = 'rule'; rule.innerHTML = '<i></i>price only goes up — dips are flattened'; ['#k-grad', '#k-first', '#k-buy', '#k-mcap', '#k-shape'].forEach(k => ($(k).textContent = '—')); $('#pts').textContent = ''; $('#pv').innerHTML = ''; document.querySelectorAll('.shape').forEach(s => s.classList.remove('on')); return; }
    $('#hint').classList.add('off');
    const d = 'M' + pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L');
    $('#line').setAttribute('d', d); $('#area').setAttribute('d', d + ` L${pts[N - 1].x},${H} L${pts[0].x},${H} Z`);
    $('#dots').innerHTML = pts.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="${i === N - 1 ? 7 : 5}" fill="${i === N - 1 ? '#111114' : '#fff'}" stroke="#111114" stroke-width="2" vector-effect="non-scaling-stroke"/>`).join('');
    $('#fixes').innerHTML = fixed.map(i => `<line x1="${pts[i - 1].x}" y1="${pts[i - 1].y}" x2="${pts[i].x}" y2="${pts[i].y}" stroke="#c8443a" stroke-width="3" vector-effect="non-scaling-stroke"/>`).join('');
    if (fixed.length) { rule.className = 'rule warn'; rule.innerHTML = `<i></i>${fixed.length} dip${fixed.length > 1 ? 's' : ''} flattened — price can't go down`; if (final) { clearTimeout(toastT); $('#toast').classList.add('on'); toastT = setTimeout(() => $('#toast').classList.remove('on'), 2200); } }
    else { rule.className = 'rule'; rule.innerHTML = '<i></i>valid curve — price only goes up'; }
    const P = pts.map(price); $('#pv').innerHTML = iconSvg(P);
    const dif = P.map((v, i) => (i ? v - P[i - 1] : 0)); let bi = 1; for (let i = 1; i < N; i++) if (dif[i] > dif[bi]) bi = i; const flats = dif.filter(v => v < .012).length;
    const r = cv.getBoundingClientRect(); const px = p => ({ l: p.x / W * r.width, t: p.y / H * r.height }); const a = px(pts[bi]), b = px(pts[Math.max(1, Math.floor(N / 4))]);
    $('#anns').innerHTML = `<div class="ann" style="left:${a.l}px;top:${a.t}px">biggest jump · ${Math.round(bi / (N - 1) * 100)}% sold</div>` + (flats >= 4 ? `<div class="ann soft" style="left:${b.l}px;top:${b.t}px">flat zone · ${Math.round(flats / (N - 1) * 100)}% of supply near one price</div>` : '');
    clearTimeout(quoteT); quoteT = setTimeout(() => quote(P), final ? 0 : 120);
  }
  async function quote(P) {
    const r = await fetch('/api/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ points: P, taxStartBps: taxOn ? 9500 : 0 }) }); const q = await r.json();
    if (q.error) { $('#err').textContent = q.error; $('#launch').disabled = true; return; }
    $('#err').textContent = ''; $('#launch').disabled = false;
    set('#k-grad', sol(q.toGraduateSol, 1)); set('#k-first', sol(q.first10Sol, 2)); set('#k-buy', q.oneSolBuysPct + '%'); set('#k-mcap', `${q.startMcapSol} → ${q.gradMcapSol}`); set('#k-shape', q.shape);
    document.querySelectorAll('.shape').forEach(s => s.classList.toggle('on', s.dataset.s === q.shape));
    $('#pts').innerHTML = 'prices (SOL/token) · ' + q.prices.map(v => v.toExponential(2)).join(' · ');
    $('#st2').classList.toggle('on', true); $('#st3').classList.toggle('on', true);
  }
  const start = e => { if (e.button && e.button !== 0) return; drawing = true; raw = [toSvg(e)]; pts = null; render(); e.preventDefault(); };
  const move = e => { if (!drawing) return; const p = toSvg(e); if (p.x >= raw[raw.length - 1].x) raw.push(p); if (raw.length > 3) { pts = snap(raw); render(false); } e.preventDefault(); };
  const end = () => { if (!drawing) return; drawing = false; if (raw.length > 3) pts = snap(raw); raw = []; render(true); };
  cv.addEventListener('mousedown', start); window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
  cv.addEventListener('touchstart', start, { passive: false }); window.addEventListener('touchmove', move, { passive: false }); window.addEventListener('touchend', end);
  document.querySelectorAll('.shape').forEach(s => (s.onclick = () => fromPoints(presets[s.dataset.s])));
  $('#clear').onclick = () => { pts = null; raw = []; fixed = []; render(); };
  // tax
  const tb = $('#taxbar'); let traw = [], tdraw = false;
  const tp = e => { const r = tb.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: Math.max(0, Math.min(400, (t.clientX - r.left) / r.width * 400)), y: Math.max(0, Math.min(100, (t.clientY - r.top) / r.height * 100)) }; };
  function trender() { if (traw.length < 2) return; const p = []; for (let i = 0; i <= 20; i++) { const x = i / 20 * 400; let best = traw[0]; for (const q of traw) if (Math.abs(q.x - x) < Math.abs(best.x - x)) best = q; p.push({ x, y: best.y }); } for (let i = 1; i < p.length; i++) p[i].y = Math.max(p[i].y, p[i - 1].y); p[0].y = 0; const d = 'M' + p.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' L'); $('#taxline').setAttribute('d', d); $('#taxarea').setAttribute('d', d + ' L400,100 L0,100 Z'); taxEnd = Math.round((1 - p[p.length - 1].y / 100) * 94) + 1; set('#k-tax', `95% → ${taxEnd}%`); if (taxOn) set('#k-tax2', `95% → ${taxEnd}% · 10 min`); }
  tb.addEventListener('mousedown', e => { tdraw = true; traw = [tp(e)]; e.preventDefault(); }); window.addEventListener('mousemove', e => { if (!tdraw) return; const p = tp(e); if (p.x >= traw[traw.length - 1].x) traw.push(p); trender(); }); window.addEventListener('mouseup', () => (tdraw = false));
  tb.addEventListener('touchstart', e => { tdraw = true; traw = [tp(e)]; e.preventDefault(); }, { passive: false }); window.addEventListener('touchmove', e => { if (!tdraw) return; const p = tp(e); if (p.x >= traw[traw.length - 1].x) traw.push(p); trender(); }, { passive: false }); window.addEventListener('touchend', () => (tdraw = false));
  traw = [{ x: 0, y: 0 }, { x: 100, y: 35 }, { x: 220, y: 75 }, { x: 400, y: 98 }]; trender();
  $('#taxsw').onclick = () => { taxOn = !taxOn; $('#taxcard').classList.toggle('off', !taxOn); $('#taxsw').classList.toggle('on', taxOn); $('#taxsw').lastChild.textContent = taxOn ? 'on' : 'off'; set('#k-tax2', taxOn ? `95% → ${taxEnd}% · 10 min` : 'off'); if (pts) quote(pts.map(price)); };
  // launch
  $('#launch').onclick = async () => {
    const err = $('#err'); err.textContent = '';
    if (!pts) return (err.textContent = 'draw a curve first');
    if (!wallet && !(await connect())) return;
    const body = { creator: wallet, name: $('#nm').value, ticker: $('#tk').value, description: $('#ds').value, points: pts.map(price), taxStartBps: taxOn ? 9500 : 0, firstBuySol: Number($('#fb').value) || 0 };
    const b = $('#launch'); b.disabled = true; b.textContent = 'Preparing…'; $('#st4').classList.add('on');
    try {
      const r = await fetch('/api/launch/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      if (j.dry) { location.href = `/c/${j.mint}`; return; }
      const prov = window.solana || window.phantom?.solana; const W3 = window.solanaWeb3; let sig;
      for (let i = 0; i < j.txs.length; i++) {
        b.textContent = j.txs.length > 1 ? `Sign ${i + 1} of ${j.txs.length}…` : 'Sign in your wallet…';
        const tx = W3.Transaction.from(Uint8Array.from(atob(j.txs[i]), c => c.charCodeAt(0)));
        const res = await prov.signAndSendTransaction(tx); sig = res.signature;
        b.textContent = 'Confirming…';
        await new Promise(ok => setTimeout(ok, 1500));
      }
      for (let tries = 0; tries < 20; tries++) {
        const c = await fetch('/api/launch/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint: j.mint, sig }) }); const cj = await c.json();
        if (c.ok) { location.href = `/c/${j.mint}`; return; }
        if (cj.detail) throw new Error('transaction failed on chain');
        await new Promise(ok => setTimeout(ok, 1500));
      }
      throw new Error('still confirming — check your wallet, then refresh /coins');
    } catch (e) { err.textContent = e.message; b.disabled = false; b.textContent = 'Launch this curve'; }
  };
  window.addEventListener('resize', () => pts && render(false));
}

// ---------- coin page ----------
async function coinPage(mint) {
  const j = await (await fetch(`/api/coin/${mint}`)).json(); if (j.error) return notFound();
  const { coin: c, hist, quote: q } = j; const real = c.pool && c.pool !== 'dry'; const pct = Math.round((c.progress || 0) * 100);
  app.innerHTML = `<div class="wrap">
  <div class="card coinhead"><div class="ic">${iconSvg(c.points)}</div>
    <div><h1>${esc(c.name)}</h1><div class="tk">$${esc(c.ticker)} · ${esc(c.shape)} curve · by ${short(c.creator)} · ${ago(c.created_at)} ago ${c.migrated ? '<span class="tag good">graduated</span>' : '<span class="tag">on the curve</span>'}${c.tax_start_bps ? ' <span class="tag">sniper tax</span>' : ''}</div>
      <p style="margin:0;color:var(--ink2)">${esc(c.description || '')}</p></div>
    <div class="acts">${real ? `<a class="btn pri" href="https://jup.ag/tokens/${c.mint}" target="_blank" rel="noreferrer">Buy on Jupiter</a><a class="btn" href="https://www.meteora.ag/dbc/${c.pool}" target="_blank" rel="noreferrer">Meteora</a><a class="btn" href="https://dexscreener.com/solana/${c.pool}" target="_blank" rel="noreferrer">Dexscreener</a>` : '<span class="tag">dry run</span>'}<button class="btn" id="cpy">CA ${short(c.mint)}</button></div></div>
  <div class="two">
    <div><div class="card chartbox" id="chart">${chartSvg(c, hist, q)}</div>
      <div class="card" style="margin-top:20px"><div class="ch"><h2>The curve <span class="sub">as drawn · 16 points</span></h2><span class="rule"><i></i>immutable on chain</span></div><div class="sec spec">
        <div><span>shape</span>${esc(c.shape)}</div><div><span>to graduate</span>${sol(c.to_graduate_sol, 1)}</div><div><span>launch mcap</span>${c.start_mcap_sol} SOL</div><div><span>graduation mcap</span>${c.grad_mcap_sol} SOL</div><div><span>sniper tax</span>${c.tax_start_bps ? `${c.tax_start_bps / 100}% → 1% over 10 min` : 'none'}</div><div><span>config</span><a href="https://solscan.io/account/${c.config}" target="_blank" rel="noreferrer" style="text-decoration:underline">${short(c.config)}</a></div></div></div></div>
    <aside><div class="card"><div class="sec"><h3><i data-lucide="activity"></i>Live</h3>
      <div class="kv"><span>Curve progress</span><b>${c.migrated ? 'graduated' : pct + '%'}</b></div><div class="bar" style="margin:0 0 10px"><i style="width:${c.migrated ? 100 : pct}%"></i></div>
      <div class="kv"><span>SOL on the curve</span><b>${sol(c.quote_reserve_sol, 3)}</b></div>
      <div class="kv"><span>Price</span><b>${c.price_sol ? c.price_sol.toExponential(2) + ' SOL' : '—'}</b></div>
      <div class="kv"><span>Market cap</span><b>${c.price_sol ? (c.price_sol * 1e9).toFixed(1) + ' SOL' : '—'}</b></div></div></div>
      <div class="card" style="margin-top:20px"><div class="sec"><h3><i data-lucide="link"></i>Addresses</h3><div class="addr">${c.mint}</div><p class="note">mint</p><div class="addr">${esc(c.pool)}</div><p class="note">pool</p></div></div></aside>
  </div></div>`;
  $('#cpy').onclick = () => { navigator.clipboard.writeText(c.mint); $('#cpy').textContent = 'copied'; };
}
function chartSvg(c, hist, q) {
  const W = 800, H = 380, pad = 36; const pts = (hist || []).filter(h => h[2] > 0);
  // the drawn curve as background (price vs supply), and live price as a dot on it
  const curve = c.points.map((v, i) => [pad + (W - 2 * pad) * i / (N - 1), H - pad - (H - 2 * pad) * v]);
  const d = 'M' + curve.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L');
  const prog = Math.min(1, Math.max(0, c.progress || 0)); const xi = prog * (N - 1); const i0 = Math.floor(xi), t = xi - i0; const p0 = curve[Math.min(i0, N - 1)], p1 = curve[Math.min(i0 + 1, N - 1)]; const lx = p0[0] + (p1[0] - p0[0]) * t, ly = p0[1] + (p1[1] - p0[1]) * t;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="cf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#111114" stop-opacity=".08"/><stop offset="1" stop-color="#111114" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${curve[N - 1][0]},${H} L${curve[0][0]},${H} Z" fill="url(#cf)"/><path d="${d}" fill="none" stroke="#111114" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <path d="${'M' + curve.filter((_, i) => i <= Math.ceil(xi)).map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L')} L${lx.toFixed(1)},${ly.toFixed(1)}" fill="none" stroke="#1f8a5a" stroke-width="4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="7" fill="#1f8a5a" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <text x="${pad}" y="${H - 12}" font-family="JetBrains Mono" font-size="10" fill="#9a9aa2">0% SOLD</text><text x="${W - pad}" y="${H - 12}" text-anchor="end" font-family="JetBrains Mono" font-size="10" fill="#9a9aa2">GRADUATION</text><text x="${pad}" y="22" font-family="JetBrains Mono" font-size="10" fill="#9a9aa2">PRICE · ${Math.round(prog * 100)}% ALONG THE CURVE</text></svg>`;
}

// ---------- standard ----------
function standard() {
  app.innerHTML = `<div class="wrap doc">
  <span class="std">SPL-16 · REV 2026-10</span>
  <h1>The Spline Standard</h1>
  <p>A specification for hand-drawn bonding curves on Solana, implemented on Meteora's Dynamic Bonding Curve.</p>
  <h2>1. Summary</h2><p>An SPL-16 token is an SPL token whose primary market is a Meteora DBC pool created with a per-token config whose curve is defined by up to sixteen creator-chosen price points. The drawing is the config. The config is immutable after creation and is not controlled by the creator or by spline.</p>
  <h2>2. The curve</h2><p>The creator supplies <code>N = 16</code> normalized heights <code>h₁…h₁₆ ∈ [0,1]</code>, evenly spaced over the supply sold on the curve. Heights are made non-decreasing (<code>hᵢ = max(hᵢ, hᵢ₋₁)</code>): price can only go up. Each height maps to a token price between the launch price (<code>START_MCAP / supply</code>) and the ceiling (<code>MAX_MCAP / supply</code>), then to a <code>sqrtPrice</code>. Consecutive prices form fifteen constant-product segments.</p>
  <p>Segment liquidity is weighted so that every segment sells the same share of supply — <code>Lᵢ ∝ 1 / (1/√pᵢ − 1/√pᵢ₊₁)</code> — so the x-axis of the drawing is literally percent of supply sold.</p>
  <h2>3. Parameters</h2>
  <table><tr><th>field</th><th>value</th></tr><tr><td>total supply</td><td>1,000,000,000 · 6 decimals</td></tr><tr><td>quote</td><td>SOL</td></tr><tr><td>launch mcap (bottom of canvas)</td><td>${S.config.startMcapSol} SOL</td></tr><tr><td>ceiling mcap (top of canvas)</td><td>${S.config.maxMcapSol} SOL</td></tr><tr><td>migration</td><td>Meteora DAMM v2, liquidity permanently locked</td></tr><tr><td>mint authority</td><td>revoked at creation</td></tr><tr><td>metadata update authority</td><td>none — spline does not mutate</td></tr></table>
  <h2>4. Sniper tax (optional)</h2><p>A coin may launch with a buy-fee schedule: <code>${S.config.maxTaxBps / 100}%</code> at creation decaying to <code>1%</code> over <code>${S.config.taxSeconds}</code> seconds, using the DBC exponential fee scheduler. The decay shape is chosen by the creator. Fees collected are split between the creator and spline per the config and can only decrease over time — the scheduler cannot raise a fee.</p>
  <h2>5. Fees</h2><p>Trading fees on every curve are collected in SOL. The creator receives 50% of fees as the pool creator; spline receives 50% as the config partner. Both claim directly from the pool; spline never holds creator funds.</p>
  <h2>6. Identity</h2><p>An SPL-16 token's image is its own curve rendered as a single stroke. The sixteen heights are stored in the token's metadata attributes, so any client can redraw the curve from the token alone.</p>
  <h2>7. What this is not</h2><p>It is not a new token program. SPL-16 tokens are ordinary SPL tokens and trade anywhere. It is not a promise about price: the curve fixes what each buyer pays on the way up, not where the market goes after graduation.</p>
  </div>`;
}
function notFound() { app.innerHTML = `<div class="wrap"><div class="card empty"><b>Nothing here.</b><a href="/">Back to spline</a></div></div>`; }

// ---------- router ----------
async function render() {
  await state();
  const r = location.pathname;
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', r.startsWith(a.dataset.r)));
  if (r === '/') home(); else if (r === '/coins') coins(); else if (r === '/lab') await lab(); else if (r === '/standard') standard(); else if (r.startsWith('/c/')) await coinPage(r.slice(3)); else notFound();
  if (window.lucide) lucide.createIcons();
}
fetch('/swan.svg').then(r => r.text()).then(t => { const inner = t.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, ''); document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute"><symbol id="swan" viewBox="0 0 1000 561">${inner}</symbol></svg>`); $('#mark').innerHTML = `<svg viewBox="0 0 1000 561"><use href="#swan"/></svg>`; });
render();
setInterval(() => { if (location.pathname.startsWith('/c/') || location.pathname === '/' || location.pathname === '/coins') render(); }, 30000);
