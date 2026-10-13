// A sigil: every address draws its own Bloch sphere.
// The 32 public-key bytes pick the tilt of each ring, the state vector,
// and the orbiting points, so the same address always gives the same picture.

export const TIER_COLORS = {
  Common: '#7d8aa0',
  Uncommon: '#2f7d4f',
  Rare: '#2350b8',
  Epic: '#6b3fb8',
  Legendary: '#c0352d',
  Mythic: '#c0352d',
};

export function sigilSVG(bytes, { size = 400, tier = 'Common', ink = '#152238', paper = 'none' } = {}) {
  const b = (i) => bytes[i % bytes.length];
  const R = 150, cx = 200, cy = 200;
  const accent = TIER_COLORS[tier] || ink;
  const parts = [];
  if (paper !== 'none') parts.push(`<rect width="400" height="400" fill="${paper}"/>`);

  // outer sphere
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${ink}" stroke-width="7"/>`);

  // rings: 2 to 4 great circles seen at an angle
  const rings = 2 + (b(0) % 3);
  for (let i = 0; i < rings; i++) {
    const tilt = (b(1 + i) / 255) * 180;
    const squash = 0.18 + (b(5 + i) / 255) * 0.5;
    const dashed = b(9 + i) % 4 === 0;
    parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${R}" ry="${(R * squash).toFixed(1)}" transform="rotate(${tilt.toFixed(1)} ${cx} ${cy})" fill="none" stroke="${ink}" stroke-width="${i === 0 ? 6 : 4}" ${dashed ? 'stroke-dasharray="14 12"' : ''} stroke-linecap="round" opacity="${i === 0 ? 1 : 0.75}"/>`);
  }

  // orbit points on the first ring
  const tilt0 = (b(1) / 255) * Math.PI;
  const sq0 = 0.18 + (b(5) / 255) * 0.5;
  const dots = 3 + (b(13) % 5);
  for (let i = 0; i < dots; i++) {
    const t = ((b(14 + i) / 255) + i / dots) * Math.PI * 2;
    const x0 = R * Math.cos(t), y0 = R * sq0 * Math.sin(t);
    const x = cx + x0 * Math.cos(tilt0) - y0 * Math.sin(tilt0);
    const y = cy + x0 * Math.sin(tilt0) + y0 * Math.cos(tilt0);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(6 + (b(20 + i) % 5)).toFixed(0)}" fill="${ink}"/>`);
  }

  // the state vector
  const ang = (b(26) / 255) * Math.PI * 2;
  const len = R * (0.62 + (b(27) / 255) * 0.26);
  const vx = cx + len * Math.cos(ang);
  const vy = cy + len * Math.sin(ang);
  parts.push(`<line x1="${cx}" y1="${cy}" x2="${vx.toFixed(1)}" y2="${vy.toFixed(1)}" stroke="${accent}" stroke-width="9" stroke-linecap="round"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="9" fill="${ink}"/>`);
  parts.push(`<circle cx="${vx.toFixed(1)}" cy="${vy.toFixed(1)}" r="22" fill="#ffe03d" stroke="${ink}" stroke-width="6"/>`);

  // tier marks: more rarity, more stars around the sphere
  const marks = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4, Mythic: 5 }[tier] || 0;
  for (let i = 0; i < marks; i++) {
    const a = -Math.PI / 2 + (i - (marks - 1) / 2) * 0.32;
    const x = cx + (R + 30) * Math.cos(a), y = cy + (R + 30) * Math.sin(a);
    parts.push(star(x, y, 11, accent));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="${size}" height="${size}">${parts.join('')}</svg>`;
}

function star(x, y, r, fill) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
}
