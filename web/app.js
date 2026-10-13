import { analyze, rank, tierOf } from '../src/rarity.js';
import { sigilSVG, TIER_COLORS } from '../src/sigil.js';

const $ = (id) => document.getElementById(id);
const form = $('form'), input = $('addr'), err = $('err');
const SITE = window.QR_SITE || (location.protocol.startsWith('http') ? location.host : 'quantumrarity.xyz');
const cal = await fetch('data/calibration.json').then((r) => r.json());
// Canvas needs the fonts loaded explicitly before it draws.
await Promise.all([
  ['CardSans', 'ibm-plex-sans-latin-400-normal', '400'], ['CardSans', 'ibm-plex-sans-latin-500-normal', '500'], ['CardSans', 'ibm-plex-sans-latin-600-normal', '600'],
  ['CardMono', 'ibm-plex-mono-latin-500-normal', '500'], ['CardMono', 'ibm-plex-mono-latin-600-normal', '600'],
].map(async ([family, file, weight]) => {
  const f = new FontFace(family, `url(assets/fonts/${file}.woff2)`, { weight });
  document.fonts.add(await f.load());
}));

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function fmtOdds(x) {
  if (!Number.isFinite(x)) return '∞';
  if (x < 1e12) return Math.round(x).toLocaleString('en-US');
  const e = Math.floor(Math.log10(x));
  return `${(x / 10 ** e).toFixed(1)} × 10${[...String(e)].map((d) => SUP[d]).join('')}`;
}
function fmtBeats(share) {
  if (share >= 1) return null;
  if (share < 1e-6) return '99.9999%+';
  const digits = Math.min(4, Math.max(0, Math.ceil(-Math.log10(share)) - 1));
  return `${(100 * (1 - share)).toFixed(digits)}%`;
}

let current = null;

function show(address) {
  const r = analyze(address);
  if (r.error) {
    $('result').hidden = true;
    err.className = 'err' + (r.error.kind === 'secret' ? ' secret' : '');
    err.textContent = r.error.kind === 'empty' ? '' :
      r.error.kind === 'secret' ? `Stop. ${r.error.why} Never paste it into any website, including this one. Paste the public address instead.` : r.error.why;
    if (r.error.kind === 'secret') input.value = '';
    return;
  }
  err.textContent = ''; err.className = 'err';
  const rk = rank(r.score, cal);
  const tier = tierOf(rk.oneIn).name;
  const bytes = analyzeBytes(r.address);
  current = { ...r, rk, tier, bytes };

  const beats = fmtBeats(rk.share);
  $('verdict').innerHTML = r.traits.length
    ? `<span>${tier}</span>: 1 in ${fmtOdds(rk.oneIn)} wallets`
    : `<span>Common</span>: a plain random wallet`;
  $('addrOut').innerHTML = highlight(r.address, r.traits.map((t) => t.span).filter(Boolean));
  const rows = r.traits.map((t) => {
    const w = Math.min(100, (-Math.log10(t.p) / 12) * 100);
    return `<tr><td>${esc(t.label)}<small>${esc(t.detail)}</small><div class="bar"><i style="width:${w.toFixed(1)}%"></i></div></td><td class="o">1 in ${fmtOdds(1 / t.p)}</td></tr>`;
  });
  $('traits').innerHTML = rows.join('');
  $('plain').hidden = r.traits.length > 0;
  $('result').hidden = false;
  drawCard(current, beats);
  if (location.hash.slice(1) !== r.address) history.replaceState(null, '', '#' + r.address);
}

function analyzeBytes(a) {
  const ALPH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  // decode is already validated; derive bytes again for the sigil
  let n = 0n;
  for (const c of a) n = n * 58n + BigInt(ALPH.indexOf(c));
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n; }
  return out;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function highlight(a, spans) {
  const on = new Array(a.length).fill(false);
  for (const [i, j] of spans) for (let k = i; k < j; k++) on[k] = true;
  let out = '', open = false;
  for (let k = 0; k < a.length; k++) {
    if (on[k] && !open) { out += '<mark>'; open = true; }
    if (!on[k] && open) { out += '</mark>'; open = false; }
    out += esc(a[k]);
  }
  return out + (open ? '</mark>' : '');
}

// ---------- the share card ----------
async function drawCard(c, beats) {
  const cv = $('card'), g = cv.getContext('2d');
  const W = 1200, H = 675;
  g.fillStyle = '#e8edf2'; g.fillRect(0, 0, W, H);
  g.lineWidth = 1;
  for (let x = 0; x <= W; x += 25) { g.strokeStyle = x % 125 ? '#d9e0e8' : '#c9d4df'; g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, H); g.stroke(); }
  for (let y = 0; y <= H; y += 25) { g.strokeStyle = y % 125 ? '#d9e0e8' : '#c9d4df'; g.beginPath(); g.moveTo(0, y + .5); g.lineTo(W, y + .5); g.stroke(); }

  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sigilSVG(c.bytes, { size: 500, tier: c.tier }));
  await img.decode();
  g.drawImage(img, 40, 88, 500, 500);

  const X = 600, ink = '#152238', ink2 = '#4b5a73';
  g.fillStyle = ink; g.font = '600 22px CardSans'; g.fillText('QUANTUM RARITY', X, 92);
  g.fillStyle = ink; g.fillRect(X, 106, 550, 3);

  g.fillStyle = TIER_COLORS[c.tier]; g.font = '600 62px CardSans'; g.fillText(c.tier.toUpperCase(), X, 182);
  g.fillStyle = ink;
  const odds = c.traits.length ? `1 in ${fmtOdds(c.rk.oneIn)}` : 'plain random';
  let size = 78; g.font = `600 ${size}px CardMono`;
  while (g.measureText(odds).width > 560 && size > 40) { size -= 4; g.font = `600 ${size}px CardMono`; }
  g.fillText(odds, X, 272);
  g.fillStyle = ink2; g.font = '400 27px CardSans';
  g.fillText(beats ? `rarer than ${beats} of Solana wallets` : 'like 89% of Solana wallets', X, 318);

  // top traits
  g.font = '500 25px CardSans'; g.fillStyle = ink;
  c.traits.slice(0, 2).forEach((t, i) => {
    const y = 378 + i * 40;
    g.fillStyle = i === 0 ? '#c0352d' : ink;
    g.beginPath(); g.arc(X + 8, y - 8, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = ink; g.fillText(t.label, X + 28, y);
  });

  // address, two lines, with the rare parts highlighted
  const a = c.address, half = Math.ceil(a.length / 2);
  const on = new Array(a.length).fill(false);
  for (const t of c.traits) if (t.span) for (let k = t.span[0]; k < t.span[1]; k++) on[k] = true;
  g.font = '500 25px CardMono';
  const cw = g.measureText('M').width;
  for (let line = 0; line < 2; line++) {
    const y = 500 + line * 38;
    for (let k = line * half; k < Math.min(a.length, (line + 1) * half); k++) {
      const x = X + (k - line * half) * cw;
      if (on[k]) { g.fillStyle = '#ffe03d'; g.fillRect(x - 1, y - 25, cw + 2, 33); }
      g.fillStyle = on[k] ? ink : ink2; g.fillText(a[k], x, y);
    }
  }

  g.fillStyle = ink; g.fillRect(X, 590, 550, 2);
  g.font = '600 24px CardMono'; g.fillStyle = '#2350b8'; g.fillText(SITE, X, 628);
  g.font = '400 20px CardSans'; g.fillStyle = ink2; g.textAlign = 'right'; g.fillText('check yours', X + 550, 628); g.textAlign = 'left';
}

// ---------- actions ----------
form.addEventListener('submit', (e) => { e.preventDefault(); show(input.value); });
input.addEventListener('paste', () => setTimeout(() => show(input.value), 0));
document.querySelectorAll('.examples button').forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.a; show(b.dataset.a); }));

$('download').addEventListener('click', () => {
  if (!current) return;
  const link = document.createElement('a');
  link.download = `rarity-${current.address.slice(0, 8)}.png`;
  link.href = $('card').toDataURL('image/png');
  link.click();
});
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); $('copy').textContent = 'Copied'; } catch { $('copy').textContent = 'Copy failed'; }
  setTimeout(() => ($('copy').textContent = 'Copy link'), 1500);
});
$('share').addEventListener('click', () => {
  if (!current) return;
  const c = current;
  const beats = fmtBeats(c.rk.share);
  const text = c.traits.length
    ? `my Solana wallet is ${c.tier.toLowerCase()} 👀\n\n1 in ${fmtOdds(c.rk.oneIn)} wallets${beats ? `, rarer than ${beats}` : ''}\n${c.traits[0].label}\n\ncheck yours:`
    : `my Solana wallet is perfectly plain 😐\n\ncheck if yours is rarer:`;
  const url = location.protocol.startsWith('http') ? location.href : `https://${SITE}/#${c.address}`;
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener');
});

const start = location.hash.slice(1);
if (start) { input.value = decodeURIComponent(start); show(input.value); }
