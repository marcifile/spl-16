// SPL-16 frontend. Routes: / , /coins , /lab , /c/:mint , /mine , /standard
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = a => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '—');
const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? `${s | 0}s` : s < 3600 ? `${(s / 60) | 0}m` : s < 86400 ? `${(s / 3600) | 0}h` : `${(s / 86400) | 0}d`; };
const sol = (n, d = 1) => `${Number(n || 0).toFixed(d)} SOL`;
const N = 16;
let S = null, wallet = null, PRESETS = null;

// ---------- curve drawing helpers ----------
function curvePath(points, W, H, pad) {
  const pts = points.map((v, i) => [pad + (W - 2 * pad) * i / (N - 1), H - pad - (H - 2 * pad) * v]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2; d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`; }
  return { d, pts };
}
const glyph = (points, w = 40, h = 24) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${curvePath(points, w, h, 3).d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const iconSvg = points => { const s = 200, { d, pts } = curvePath(points, s, s, 32), e = pts[pts.length - 1]; return `<svg viewBox="0 0 ${s} ${s}"><rect width="${s}" height="${s}" fill="#f4f2ec"/><path d="${d}" fill="none" stroke="#111114" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${e[0].toFixed(1)}" cy="${e[1].toFixed(1)}" r="5.6" fill="#f4f2ec"/></svg>`; };
const coinIcon = c => c.logo ? `<img src="${esc(c.logo)}" alt="">` : iconSvg(c.points);

// ---------- wallet ----------
const provider = () => window.solana || window.phantom?.solana;
async function connect() { const p = provider(); if (!p) { alert('No Solana wallet found. Install Phantom.'); return null; } const r = await p.connect(); wallet = r.publicKey.toString(); paintWallet(); return wallet; }
function paintWallet() { const b = $('#wallet span'); b.textContent = wallet ? short(wallet) : 'Connect'; const m = $('#minelink'); if (m) m.style.display = wallet ? '' : 'none'; }
$('#wallet').onclick = async () => { if (wallet) { try { await provider().disconnect(); } catch {} wallet = null; paintWallet(); } else connect(); };
provider()?.connect?.({ onlyIfTrusted: true }).then(r => { wallet = r.publicKey.toString(); paintWallet(); }).catch(() => {});
async function state() { S = await (await fetch('/api/state')).json(); if (!PRESETS) PRESETS = await (await fetch('/api/presets')).json(); return S; }

// ---------- shared: the canvas ----------
// mount(el, {compact}) renders the drawing surface + side panel; returns controller
function canvasHTML({ compact }) {
  return `
  <div class="card lab-card">
    <div class="ch"><h2>Price curve <span class="sub">price · % of supply sold</span></h2><div class="chr"><span class="rule" id="rule"><i></i>price only goes up</span><button class="btn sm" id="clear">Clear</button></div></div>
    <div class="stage"><div class="canvas" id="cv">
      <div class="grid-bg"></div>
      <svg id="svg" viewBox="0 0 1000 560" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#111114" stop-opacity=".07"/><stop offset="1" stop-color="#111114" stop-opacity="0"/></linearGradient></defs>
        <path id="area" fill="url(#fill)"/><path id="raw" fill="none" stroke="#9a9aa3" stroke-width="1.5" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/><path id="line" fill="none" stroke="#111114" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><g id="fixes"></g><g id="dots"></g></svg>
      <div class="ylab" id="ylab"></div><div class="xlab" id="xlab"></div>
      <div class="hint" id="hint"><b>Draw, left to right</b>any shape · snaps to 16 points · price can only go up</div>
      <div id="anns"></div><div class="toast" id="toast">price can't go down — that part was flattened</div>
    </div></div>
    <div class="legend"><span><span class="sw"></span>your curve · 16 points</span><span><span class="sw dash"></span>stroke</span><span><span class="sw" style="background:var(--bad)"></span>flattened</span><span class="r mono" id="axnote">y: market cap in SOL · x: supply sold</span></div>
  </div>
  <div class="side">
    <div class="card step" id="s1"><div class="sec">
      <div class="sh"><b>1</b><h3>Draw</h3><span class="shape-tag" id="k-shape">—</span></div>
      <div class="shapes" id="shapes">${Object.keys(PRESETS).map(k => `<div class="shape" data-s="${k}" title="${k}">${glyph(PRESETS[k], 34, 20)}<i>${k}</i></div>`).join('')}</div>
      <div class="kvs">
        <div class="kv"><span>To graduate</span><b id="k-grad">—</b></div>
        <div class="kv"><span>First 10% costs</span><b id="k-first">—</b></div>
        <div class="kv"><span>1 SOL at launch</span><b id="k-buy">—</b></div>
        <div class="kv"><span>Mcap launch → grad</span><b id="k-mcap">—</b></div>
      </div></div></div>
    <div class="card step locked" id="s2"><div class="sec">
      <div class="sh"><b>2</b><h3>Sniper tax</h3><label class="switch" id="taxsw"><i></i><span>off</span></label></div>
      <div class="body">
        <p class="note">Buy fee for the first 10 minutes, paid to the curve. Starts at 95%, decays to the floor you draw. Meteora's scheduler can only decrease a fee — never raise it.</p>
        <div class="canvas tax" id="taxbar"><div class="grid-bg" style="background-size:10% 25%"></div><svg id="taxsvg" viewBox="0 0 400 100" preserveAspectRatio="none"><path id="taxarea" fill="#c8443a" fill-opacity=".08"/><path id="taxline" fill="none" stroke="#c8443a" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><span class="axis" style="left:8px;top:6px">95%</span><span class="axis" style="left:8px;bottom:6px">1%</span><span class="axis" style="right:8px;bottom:6px">10 min</span><span class="axis" style="left:50%;bottom:6px;transform:translateX(-50%)">5 min</span></div>
        <div class="kv"><span>Fee at launch → 10 min</span><b id="k-tax">95% → 1%</b></div>
      </div></div></div>
    <div class="card step locked" id="s3"><div class="sec">
      <div class="sh"><b>3</b><h3>Name</h3></div>
      <div class="body">
        <div class="grid2"><div class="field"><label>Name</label><input id="nm" placeholder="ledge" maxlength="32"></div><div class="field"><label>Ticker</label><input id="tk" placeholder="LEDGE" maxlength="10" style="text-transform:uppercase"></div></div>
        <div class="field"><label>Description <em>optional</em></label><textarea id="ds" maxlength="300" placeholder="one line"></textarea></div>
        <div class="field"><label>Logo <em>optional · square · under 2 MB</em></label>
          <div class="logo-row"><div class="ic" id="pv"></div><div><input type="file" id="logo" accept="image/png,image/jpeg,image/webp,image/gif" hidden><button class="btn sm" id="logobtn" type="button">Upload image</button><button class="btn sm ghost" id="logoclr" type="button" style="display:none">Use curve</button><p class="note" style="margin-top:6px">No logo? Your curve is the icon.</p></div></div>
        </div>
        <div class="field"><label>Your first buy <em>SOL · optional</em></label><input id="fb" type="number" min="0" step="0.05" placeholder="0"></div>
      </div></div></div>
    <div class="card step locked" id="s4"><div class="sec">
      <div class="sh"><b>4</b><h3>Launch</h3></div>
      <div class="body">
        <button class="btn pri big wide" id="launch" disabled>Connect wallet to launch</button>
        <div class="err" id="err"></div>
        <p class="note">One transaction, signed in your wallet: creates the pool config and the coin on Meteora DBC. The curve is immutable afterwards. Network cost ≈ 0.03 SOL plus your first buy.</p>
      </div></div></div>
  </div>`;
}

function mountCanvas(root, { compact = false } = {}) {
  root.innerHTML = canvasHTML({ compact });
  const W = 1000, H = 560, PAD = 36; const cv = $('#cv'); let raw = [], pts = null, fixed = [], drawing = false, toastT = null, quoteT = null, taxOn = false, taxEnd = 1, logoData = null, lastQ = null;
  const toSvg = e => { const r = cv.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: (t.clientX - r.left) / r.width * W, y: (t.clientY - r.top) / r.height * H }; };
  const price = p => (H - PAD - p.y) / (H - 2 * PAD);
  const stepOn = (n, on) => $(`#s${n}`).classList.toggle('locked', !on);
  // axis labels: y = mcap in SOL (from config), x = % supply
  const lo = S.config.startMcapSol, hi = S.config.maxMcapSol;
  $('#ylab').innerHTML = [1, .75, .5, .25, 0].map(v => `<span style="top:${(PAD + (H - 2 * PAD) * (1 - v)) / H * 100}%">${Math.round(lo + (hi - lo) * v)}</span>`).join('') + `<span class="axt">mcap · SOL</span>`;
  $('#xlab').innerHTML = [0, 25, 50, 75, 100].map(v => `<span style="left:${(PAD + (W - 2 * PAD) * v / 100) / W * 100}%">${v}%</span>`).join('');
  function snap(samples) { const xs = [], ys = [], fx = []; for (let i = 0; i < N; i++) { const x = PAD + (W - 2 * PAD) * i / (N - 1); xs.push(x); let best = null, bd = 1e9; for (const p of samples) { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = p; } } ys.push(best ? best.y : H - PAD); } for (let i = 1; i < N; i++) { if (ys[i] > ys[i - 1] + .5) fx.push(i); ys[i] = Math.min(ys[i], ys[i - 1]); } for (let i = 0; i < N; i++) ys[i] = Math.max(PAD, Math.min(H - PAD, ys[i])); if (ys[N - 1] >= ys[0] - 8) ys[N - 1] = Math.max(PAD, ys[0] - 60); fixed = fx; return xs.map((x, i) => ({ x, y: ys[i] })); }
  function fromPoints(P) { raw = []; fixed = []; pts = P.map((v, i) => ({ x: PAD + (W - 2 * PAD) * i / (N - 1), y: H - PAD - (H - 2 * PAD) * v })); render(true); }
  function set(id, v) { const el = $(id); if (!el) return; if (el.textContent !== v) { el.textContent = v; el.classList.add('hot'); setTimeout(() => el.classList.remove('hot'), 250); } }
  function paintPreview() { $('#pv').innerHTML = logoData ? `<img src="${logoData}" alt="">` : (pts ? iconSvg(pts.map(price)) : ''); }
  function render(final) {
    $('#raw').setAttribute('d', raw.length > 1 ? 'M' + raw.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L') : '');
    const rule = $('#rule');
    if (!pts) { ['#line', '#area'].forEach(i => $(i).setAttribute('d', '')); $('#dots').innerHTML = ''; $('#fixes').innerHTML = ''; $('#anns').innerHTML = ''; $('#hint').classList.remove('off'); rule.className = 'rule'; rule.innerHTML = '<i></i>price only goes up'; ['#k-grad', '#k-first', '#k-buy', '#k-mcap', '#k-shape'].forEach(k => ($(k).textContent = '—')); document.querySelectorAll('.shape').forEach(s => s.classList.remove('on')); stepOn(2, false); stepOn(3, false); stepOn(4, false); paintPreview(); return; }
    $('#hint').classList.add('off');
    const d = 'M' + pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L');
    $('#line').setAttribute('d', d); $('#area').setAttribute('d', d + ` L${pts[N - 1].x},${H} L${pts[0].x},${H} Z`);
    $('#dots').innerHTML = pts.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="${i === N - 1 ? 7 : 5}" fill="${i === N - 1 ? '#111114' : '#fff'}" stroke="#111114" stroke-width="2" vector-effect="non-scaling-stroke"/>`).join('');
    $('#fixes').innerHTML = fixed.map(i => `<line x1="${pts[i - 1].x}" y1="${pts[i - 1].y}" x2="${pts[i].x}" y2="${pts[i].y}" stroke="#c8443a" stroke-width="3" vector-effect="non-scaling-stroke"/>`).join('');
    if (fixed.length) { rule.className = 'rule warn'; rule.innerHTML = `<i></i>${fixed.length} dip${fixed.length > 1 ? 's' : ''} flattened`; if (final) { clearTimeout(toastT); $('#toast').classList.add('on'); toastT = setTimeout(() => $('#toast').classList.remove('on'), 2200); } }
    else { rule.className = 'rule'; rule.innerHTML = '<i></i>valid · price only goes up'; }
    const P = pts.map(price); paintPreview();
    const dif = P.map((v, i) => (i ? v - P[i - 1] : 0)); let bi = 1; for (let i = 1; i < N; i++) if (dif[i] > dif[bi]) bi = i; const flats = dif.filter(v => v < .012).length;
    const r = cv.getBoundingClientRect(); const px = p => ({ l: p.x / W * r.width, t: p.y / H * r.height }); const a = px(pts[bi]), b = px(pts[Math.max(1, Math.floor(N / 4))]);
    $('#anns').innerHTML = `<div class="ann" style="left:${a.l}px;top:${a.t}px">steepest · ${Math.round(bi / (N - 1) * 100)}% sold</div>` + (flats >= 4 ? `<div class="ann soft" style="left:${b.l}px;top:${b.t}px">flat · ${Math.round(flats / (N - 1) * 100)}% of supply near one price</div>` : '');
    clearTimeout(quoteT); quoteT = setTimeout(() => quote(P, final), final ? 0 : 120);
  }
  async function quote(P, final) {
    const r = await fetch('/api/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ points: P, taxStartBps: taxOn ? 9500 : 0 }) }); const q = await r.json();
    if (q.error) { $('#err').textContent = q.error; return; } lastQ = q; $('#err').textContent = '';
    set('#k-grad', sol(q.toGraduateSol, 1)); set('#k-first', sol(q.first10Sol, 2)); set('#k-buy', q.oneSolBuysPct + '% of supply'); set('#k-mcap', `${q.startMcapSol} → ${q.gradMcapSol} SOL`); set('#k-shape', q.shape);
    document.querySelectorAll('.shape').forEach(s => s.classList.toggle('on', s.dataset.s === q.shape)); // detected, not selected
    if (final) { stepOn(2, true); } // step 2 unlocks when the drawing is finished; 3 and 4 unlock as the user proceeds
    updateLaunch();
  }
  function updateLaunch() { const b = $('#launch'); const named = $('#nm').value.trim().length > 0 && $('#tk').value.trim().length >= 2; b.disabled = !(pts && lastQ && named); b.textContent = !wallet ? 'Connect wallet to launch' : !pts ? 'Draw a curve first' : !named ? 'Name it first' : 'Launch this curve'; }
  const start = e => { if (e.button && e.button !== 0) return; drawing = true; raw = [toSvg(e)]; pts = null; render(); e.preventDefault(); };
  const move = e => { if (!drawing) return; const p = toSvg(e); if (p.x >= raw[raw.length - 1].x) raw.push(p); if (raw.length > 3) { pts = snap(raw); render(false); } e.preventDefault(); };
  const end = () => { if (!drawing) return; drawing = false; if (raw.length > 3) pts = snap(raw); raw = []; render(true); };
  cv.addEventListener('mousedown', start); window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
  cv.addEventListener('touchstart', start, { passive: false }); window.addEventListener('touchmove', move, { passive: false }); window.addEventListener('touchend', end);
  document.querySelectorAll('.shape').forEach(s => (s.onclick = () => fromPoints(PRESETS[s.dataset.s])));
  $('#clear').onclick = () => { pts = null; raw = []; fixed = []; lastQ = null; render(); };
  // step gating: focusing the tax or name step unlocks the next
  $('#s2').addEventListener('click', () => { if (!$('#s2').classList.contains('locked')) stepOn(3, true); });
  ['#nm', '#tk'].forEach(id => $(id).addEventListener('input', () => { stepOn(4, true); updateLaunch(); }));
  $('#s3').addEventListener('click', () => { if (!$('#s3').classList.contains('locked')) stepOn(4, true); });
  // tax
  const tb = $('#taxbar'); let traw = [], tdraw = false;
  const tp = e => { const r = tb.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: Math.max(0, Math.min(400, (t.clientX - r.left) / r.width * 400)), y: Math.max(0, Math.min(100, (t.clientY - r.top) / r.height * 100)) }; };
  function trender() { if (traw.length < 2) return; const p = []; for (let i = 0; i <= 20; i++) { const x = i / 20 * 400; let best = traw[0]; for (const q of traw) if (Math.abs(q.x - x) < Math.abs(best.x - x)) best = q; p.push({ x, y: best.y }); } for (let i = 1; i < p.length; i++) p[i].y = Math.max(p[i].y, p[i - 1].y); p[0].y = 0; const d = 'M' + p.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' L'); $('#taxline').setAttribute('d', d); $('#taxarea').setAttribute('d', d + ' L400,100 L0,100 Z'); taxEnd = Math.round((1 - p[p.length - 1].y / 100) * 94) + 1; set('#k-tax', `95% → ${taxEnd}%`); }
  tb.addEventListener('mousedown', e => { if ($('#s2').classList.contains('locked') || !taxOn) return; tdraw = true; traw = [tp(e)]; e.preventDefault(); }); window.addEventListener('mousemove', e => { if (!tdraw) return; const p = tp(e); if (p.x >= traw[traw.length - 1].x) traw.push(p); trender(); }); window.addEventListener('mouseup', () => (tdraw = false));
  tb.addEventListener('touchstart', e => { if ($('#s2').classList.contains('locked') || !taxOn) return; tdraw = true; traw = [tp(e)]; e.preventDefault(); }, { passive: false }); window.addEventListener('touchmove', e => { if (!tdraw) return; const p = tp(e); if (p.x >= traw[traw.length - 1].x) traw.push(p); trender(); }, { passive: false }); window.addEventListener('touchend', () => (tdraw = false));
  traw = [{ x: 0, y: 0 }, { x: 100, y: 35 }, { x: 220, y: 75 }, { x: 400, y: 98 }]; trender();
  $('#taxsw').onclick = e => { e.stopPropagation(); if ($('#s2').classList.contains('locked')) return; taxOn = !taxOn; $('#taxsw').classList.toggle('on', taxOn); $('#taxsw').querySelector('span').textContent = taxOn ? 'on' : 'off'; $('#s2').classList.toggle('tax-on', taxOn); stepOn(3, true); if (pts) quote(pts.map(price), false); };
  // logo
  $('#logobtn').onclick = () => $('#logo').click();
  $('#logo').onchange = () => { const f = $('#logo').files[0]; if (!f) return; if (f.size > 2_000_000) return ($('#err').textContent = 'logo must be under 2 MB'); const rd = new FileReader(); rd.onload = () => { logoData = rd.result; paintPreview(); $('#logoclr').style.display = ''; }; rd.readAsDataURL(f); };
  $('#logoclr').onclick = () => { logoData = null; $('#logo').value = ''; paintPreview(); $('#logoclr').style.display = 'none'; };
  // launch
  $('#launch').onclick = async () => {
    const err = $('#err'); err.textContent = '';
    if (!wallet && !(await connect())) return; updateLaunch(); if ($('#launch').disabled) return;
    const body = { creator: wallet, name: $('#nm').value, ticker: $('#tk').value, description: $('#ds').value, points: pts.map(price), taxStartBps: taxOn ? 9500 : 0, firstBuySol: Number($('#fb').value) || 0, logo: logoData };
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
      throw new Error('still confirming — check your wallet, then open /mine');
    } catch (e) { err.textContent = e.message; updateLaunch(); }
  };
  window.addEventListener('resize', () => pts && render(false));
  paintWallet(); updateLaunch();
  return { fromPoints };
}

// ---------- pages ----------
function coinCard(c) {
  const pct = Math.round((c.progress || 0) * 100);
  return `<a class="card coin" href="/c/${c.mint}"><div class="ic">${coinIcon(c)}</div><div>
    <div class="t">${esc(c.name)} <span class="tk">$${esc(c.ticker)}</span></div>
    <div class="m"><span class="g">${glyph(c.points, 36, 18)}</span><span>${esc(c.shape)}</span><span>·</span><span>${ago(c.created_at)}</span>${c.tax_start_bps ? `<span class="tag">tax</span>` : ''}${c.migrated ? `<span class="tag good">graduated</span>` : ''}</div>
    <div class="bar"><i style="width:${c.migrated ? 100 : pct}%"></i></div>
    <div class="m2"><b>${sol(c.quote_reserve_sol, 2)}</b> / ${sol(c.to_graduate_sol, 0)} · ${c.price_sol ? (c.price_sol * 1e9).toFixed(1) + ' SOL mcap' : 'no trades yet'}</div></div></a>`;
}
function home() {
  const latest = S.coins.slice(0, 8);
  app.innerHTML = `<div class="wrap">
  <section class="homehead"><div><span class="std">THE SPLINE STANDARD · REV 2026-10</span><h1>Draw the curve. <em>Launch the coin.</em></h1></div>
    <p>Each coin on SPL-16 trades on a bonding curve its creator drew. Sixteen price points, written into a Meteora DBC config, enforced on chain from the first buy.</p></section>
  <section class="lab" id="labroot"></section>
  <section class="latest"><div class="ch" style="border:0;padding:28px 0 14px"><h2>Latest curves <span class="sub">${S.totals.coins} drawn · ${S.totals.graduated} graduated · ${Number(S.totals.tvl).toFixed(1)} SOL on curves</span></h2><a href="/coins" class="xl">All coins →</a></div>
  ${latest.length ? `<div class="grid">${latest.map(coinCard).join('')}</div>` : `<div class="card empty"><b>No coins yet.</b>Draw the first one above.</div>`}</section></div>`;
  $('#labroot').classList.add('compact'); mountCanvas($('#labroot'), { compact: true });
}
function coins() {
  app.innerHTML = `<div class="wrap"><div class="ch" style="border:0;padding:0 0 18px"><h2 class="pg">All coins <span class="sub">${S.coins.length}</span></h2><a class="btn pri" href="/">Draw a coin</a></div>
  ${S.coins.length ? `<div class="grid">${S.coins.map(coinCard).join('')}</div>` : `<div class="card empty"><b>No coins yet.</b><a href="/">Draw the first one.</a></div>`}</div>`;
}
async function mine() {
  if (!wallet && !(await connect())) return (app.innerHTML = `<div class="wrap"><div class="card empty"><b>Connect a wallet</b>to see the curves you drew.</div></div>`);
  const j = await (await fetch(`/api/mine/${wallet}`)).json();
  app.innerHTML = `<div class="wrap"><div class="ch" style="border:0;padding:0 0 18px"><h2 class="pg">Your curves <span class="sub">${j.coins.length} · ${short(wallet)}</span></h2><a class="btn pri" href="/">Draw another</a></div>
  ${j.coins.length ? `<div class="grid">${j.coins.map(coinCard).join('')}</div>` : `<div class="card empty"><b>Nothing yet.</b><a href="/">Draw your first curve.</a></div>`}</div>`;
}
function lab() { app.innerHTML = `<div class="wrap"><div class="ch" style="border:0;padding:0 0 18px"><h2 class="pg">Lab</h2><span class="std">16 POINTS · METEORA DBC</span></div><section class="lab" id="labroot"></section></div>`; mountCanvas($('#labroot')); }

async function coinPage(mint) {
  const j = await (await fetch(`/api/coin/${mint}`)).json(); if (j.error) return notFound();
  const { coin: c, hist, quote: q } = j; const real = c.pool && c.pool !== 'dry'; const pct = Math.round((c.progress || 0) * 100); const isNew = new URLSearchParams(location.search).get('new');
  app.innerHTML = `<div class="wrap">
  ${isNew ? `<div class="card banner"><i data-lucide="check-circle-2"></i><div><b>Live on Meteora.</b> Your curve is on chain and trading. Share the CA — and the drawing.</div><button class="btn sm" id="share">Copy link</button></div>` : ''}
  <div class="card coinhead"><div class="ic">${coinIcon(c)}</div>
    <div><h1>${esc(c.name)} <span class="tk">$${esc(c.ticker)}</span></h1>
      <div class="meta"><span class="g">${glyph(c.points, 40, 20)}</span><span>${esc(c.shape)} curve</span><span>·</span><span>by <a href="https://solscan.io/account/${c.creator}" target="_blank" rel="noreferrer">${short(c.creator)}</a></span><span>·</span><span>${ago(c.created_at)} ago</span>${c.migrated ? '<span class="tag good">graduated</span>' : '<span class="tag">on the curve</span>'}${c.tax_start_bps ? '<span class="tag">sniper tax</span>' : ''}</div>
      ${c.description ? `<p>${esc(c.description)}</p>` : ''}</div>
    <div class="acts">${real ? `<a class="btn pri" href="https://jup.ag/tokens/${c.mint}" target="_blank" rel="noreferrer">Buy on Jupiter</a><a class="btn" href="https://www.meteora.ag/dbc/${c.pool}" target="_blank" rel="noreferrer">Meteora</a><a class="btn" href="https://dexscreener.com/solana/${c.pool}" target="_blank" rel="noreferrer">Dexscreener</a>` : '<span class="tag">dry run</span>'}<button class="btn" id="cpy">CA ${short(c.mint)}</button></div></div>
  <div class="two">
    <div><div class="card chartbox" id="chart">${chartSvg(c, hist, q)}</div>
      <div class="card" style="margin-top:20px"><div class="ch"><h2>The curve <span class="sub">as drawn</span></h2><span class="rule"><i></i>immutable · on chain</span></div>
        <div class="spec2"><div><span>shape</span><b>${esc(c.shape)}</b></div><div><span>to graduate</span><b>${sol(c.to_graduate_sol, 1)}</b></div><div><span>launch mcap</span><b>${c.start_mcap_sol} SOL</b></div><div><span>graduation mcap</span><b>${c.grad_mcap_sol} SOL</b></div><div><span>sniper tax</span><b>${c.tax_start_bps ? `${c.tax_start_bps / 100}% → 1% · 10 min` : 'none'}</b></div><div><span>config</span><b><a href="https://solscan.io/account/${c.config}" target="_blank" rel="noreferrer">${short(c.config)}</a></b></div></div>
        ${c.logo ? `<div class="sec" style="border-top:1px solid var(--line);display:flex;gap:14px;align-items:center"><div class="ic sm">${iconSvg(c.points)}</div><div class="note" style="margin:0">The curve as an icon. The creator uploaded a logo; this is what the drawing looks like.</div></div>` : ''}</div></div>
    <aside><div class="card"><div class="sec"><h3><i data-lucide="activity"></i>Live</h3>
      <div class="kv"><span>Curve progress</span><b>${c.migrated ? 'graduated' : pct + '%'}</b></div><div class="bar" style="margin:0 0 10px"><i style="width:${c.migrated ? 100 : pct}%"></i></div>
      <div class="kv"><span>SOL on the curve</span><b>${sol(c.quote_reserve_sol, 3)}</b></div>
      <div class="kv"><span>Price</span><b>${c.price_sol ? c.price_sol.toExponential(2) + ' SOL' : '—'}</b></div>
      <div class="kv"><span>Market cap</span><b>${c.price_sol ? (c.price_sol * 1e9).toFixed(1) + ' SOL' : '—'}</b></div>
      <div class="kv"><span>Last sample</span><b>${c.last_seen ? ago(c.last_seen) + ' ago' : '—'}</b></div></div></div>
      <div class="card" style="margin-top:20px"><div class="sec"><h3><i data-lucide="link"></i>Addresses</h3><div class="addr">${c.mint}</div><p class="note">mint</p><div class="addr">${esc(c.pool)}</div><p class="note">pool</p>${real ? `<p class="note"><a href="https://solscan.io/tx/${c.launch_sig}" target="_blank" rel="noreferrer">launch transaction ↗</a></p>` : ''}</div></div></aside>
  </div></div>`;
  $('#cpy').onclick = () => { navigator.clipboard.writeText(c.mint); $('#cpy').textContent = 'copied'; };
  const sh = $('#share'); if (sh) sh.onclick = () => { navigator.clipboard.writeText(`${location.origin}/c/${c.mint}`); sh.textContent = 'copied'; };
}
function chartSvg(c, hist, q) {
  const W = 800, H = 380, pad = 44, padB = 34; const lo = S.config.startMcapSol, hi = S.config.maxMcapSol;
  const curve = c.points.map((v, i) => [pad + (W - 2 * pad) * i / (N - 1), H - padB - (H - padB - 24) * v]);
  const d = 'M' + curve.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L');
  const prog = Math.min(1, Math.max(0, c.progress || 0)); const xi = prog * (N - 1); const i0 = Math.floor(xi), t = xi - i0; const p0 = curve[Math.min(i0, N - 1)], p1 = curve[Math.min(i0 + 1, N - 1)]; const lx = p0[0] + (p1[0] - p0[0]) * t, ly = p0[1] + (p1[1] - p0[1]) * t;
  const ylabs = [0, .25, .5, .75, 1].map(v => `<text x="${pad - 8}" y="${(H - padB - (H - padB - 24) * v).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-family="JetBrains Mono" font-size="10" fill="#9a9aa2">${Math.round(lo + (hi - lo) * v)}</text><line x1="${pad}" x2="${W - pad}" y1="${(H - padB - (H - padB - 24) * v).toFixed(1)}" y2="${(H - padB - (H - padB - 24) * v).toFixed(1)}" stroke="#eeeeea"/>`).join('');
  const xlabs = [0, 25, 50, 75, 100].map(v => `<text x="${(pad + (W - 2 * pad) * v / 100).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="#9a9aa2">${v}%</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="cf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#111114" stop-opacity=".08"/><stop offset="1" stop-color="#111114" stop-opacity="0"/></linearGradient></defs>
    ${ylabs}${xlabs}
    <path d="${d} L${curve[N - 1][0]},${H - padB} L${curve[0][0]},${H - padB} Z" fill="url(#cf)"/><path d="${d}" fill="none" stroke="#111114" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <path d="${'M' + curve.filter((_, i) => i <= Math.ceil(xi)).map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L')} L${lx.toFixed(1)},${ly.toFixed(1)}" fill="none" stroke="#1f8a5a" stroke-width="4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="7" fill="#1f8a5a" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <text x="${pad}" y="16" font-family="JetBrains Mono" font-size="10" fill="#9a9aa2">MCAP · SOL</text><text x="${W - pad}" y="16" text-anchor="end" font-family="JetBrains Mono" font-size="10" fill="#1f8a5a">${Math.round(prog * 100)}% ALONG THE CURVE</text></svg>`;
}
function standard() {
  app.innerHTML = `<div class="wrap doc">
  <span class="std">SPL-16 · REV 2026-10</span><h1>The Spline Standard</h1>
  <p>A specification for hand-drawn bonding curves on Solana, implemented on Meteora's Dynamic Bonding Curve.</p>
  <h2>1. Summary</h2><p>An SPL-16 token is an SPL token whose primary market is a Meteora DBC pool created with a per-token config whose curve is defined by up to sixteen creator-chosen price points. The drawing is the config. The config is immutable after creation and is not controlled by the creator or by the launchpad.</p>
  <h2>2. The curve</h2><p>The creator supplies <code>N = 16</code> normalized heights <code>h₁…h₁₆ ∈ [0,1]</code>, evenly spaced over the supply sold on the curve. Heights are made non-decreasing (<code>hᵢ = max(hᵢ, hᵢ₋₁)</code>): price can only go up. Each height maps to a token price between the launch price (<code>START_MCAP / supply</code>) and the ceiling (<code>MAX_MCAP / supply</code>), then to a <code>sqrtPrice</code>. Consecutive prices form fifteen constant-product segments.</p>
  <p>Segment liquidity is weighted so every segment sells the same share of supply — <code>Lᵢ ∝ 1 / (1/√pᵢ − 1/√pᵢ₊₁)</code> — so the x-axis of the drawing is percent of supply sold.</p>
  <h2>3. Parameters</h2>
  <table><tr><th>field</th><th>value</th></tr><tr><td>total supply</td><td>1,000,000,000 · 6 decimals</td></tr><tr><td>quote</td><td>SOL</td></tr><tr><td>launch mcap (bottom of canvas)</td><td>${S.config.startMcapSol} SOL</td></tr><tr><td>ceiling mcap (top of canvas)</td><td>${S.config.maxMcapSol} SOL</td></tr><tr><td>migration</td><td>Meteora DAMM v2, liquidity permanently locked</td></tr><tr><td>mint authority</td><td>revoked at creation</td></tr><tr><td>metadata update authority</td><td>none</td></tr></table>
  <h2>4. Sniper tax (optional)</h2><p>A coin may launch with a buy-fee schedule: <code>${S.config.maxTaxBps / 100}%</code> at creation decaying to a floor chosen by the creator over <code>${S.config.taxSeconds}</code> seconds, using the DBC exponential fee scheduler. The scheduler can only decrease a fee.</p>
  <h2>5. Fees</h2><p>Trading fees are collected in SOL. The creator receives 50% as pool creator; the launchpad receives 50% as config partner. Both claim directly from the pool.</p>
  <h2>6. Identity</h2><p>The sixteen heights are stored in the token's metadata attributes (<code>curve</code>), and a rendering of the curve is stored in <code>properties.curve_image</code>, so any client can redraw the curve from the token alone. If the creator uploads a logo it becomes the token image; the curve remains in metadata.</p>
  <h2>7. Scope</h2><p>SPL-16 is not a new token program. Tokens are ordinary SPL tokens and trade anywhere. The curve fixes what each buyer pays on the way up; it says nothing about price after graduation.</p>
  </div>`;
}
function notFound() { app.innerHTML = `<div class="wrap"><div class="card empty"><b>Nothing here.</b><a href="/">Back</a></div></div>`; }

async function render() {
  await state(); const r = location.pathname;
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.r === '/' ? r === '/' : r.startsWith(a.dataset.r)));
  if (r === '/') home(); else if (r === '/coins') coins(); else if (r === '/lab') lab(); else if (r === '/mine') await mine(); else if (r === '/standard') standard(); else if (r.startsWith('/c/')) await coinPage(r.slice(3)); else notFound();
  if (window.lucide) lucide.createIcons();
}
fetch('/swan.svg').then(r => r.text()).then(t => { const inner = t.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, ''); document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute"><symbol id="swan" viewBox="0 0 1000 561">${inner}</symbol></svg>`); $('#mark').innerHTML = `<svg viewBox="0 0 1000 561"><use href="#swan"/></svg>`; });
render();
setInterval(() => { const a = document.activeElement; if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return; if (location.pathname.startsWith('/c/') || location.pathname === '/coins') render(); }, 30000);
