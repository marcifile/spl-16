// A coin's icon is its curve: the 16 points drawn as one ink stroke on paper (SVG; PNG for token metadata via sharp if present).
import { N } from './curve.js';

function strokePath(points, W, H, pad) {
  const pts = points.map((v, i) => [pad + (W - 2 * pad) * i / (N - 1), H - pad - (H - 2 * pad) * v]);
  // catmull-rom → cubic bezier
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return { d, pts };
}

export function iconSvg(points, { size = 512, ink = '#111114', paper = '#f4f2ec', bare = false } = {}) {
  const pad = size * 0.16; const { d, pts } = strokePath(points, size, size, pad);
  const end = pts[pts.length - 1];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
${bare ? '' : `<rect width="${size}" height="${size}" fill="${paper}"/>`}
<path d="${d}" fill="none" stroke="${ink}" stroke-width="${size * 0.075}" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${d}" fill="none" stroke="${paper}" stroke-width="${size * 0.012}" stroke-linecap="round" stroke-linejoin="round" opacity=".35" stroke-dasharray="${size * .3} ${size * .9}"/>
<circle cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="${size * 0.028}" fill="${paper}"/>
</svg>`;
}

// tiny inline glyph for lists
export function glyphSvg(points, ink = 'currentColor') {
  const { d } = strokePath(points, 40, 24, 3);
  return `<svg viewBox="0 0 40 24" width="40" height="24"><path d="${d}" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export async function iconPng(points, size = 512) {
  const svg = iconSvg(points, { size });
  try { const sharp = (await import('sharp')).default; return await sharp(Buffer.from(svg)).png().toBuffer(); }
  catch { return null; }
}
