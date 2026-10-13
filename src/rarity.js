// Quantum Rarity: how unusual is a Solana address?
//
// A Solana address is the base58 form of a 32-byte public key. Every trait
// below has a probability for a random key, computed from first principles:
//   - the first character follows the exact BigInt table (2..H common, K..z rare)
//   - every later character is 1 in 58
//   - runs, digit stretches and counting runs use exact dynamic programming
// A wallet's score is -log10(p) of its rarest trait (others only break ties).
// The score is then ranked against two million random keys (data/calibration.json).

import { ALPHABET, decode } from './base58.js';
import { WORDS } from './words.js';

const M = 58;
const DIGITS = '123456789';
const isDigit = (c) => c >= '1' && c <= '9';

// ---------- first character, exact ----------
function firstCharTable() {
  const TWO256 = 1n << 256n, LO = 1n << 248n;
  const t = new Map([...ALPHABET].map((c) => [c, 0]));
  t.set('1', 1 / 256);
  for (let d = 1n; d < 58n; d++) {
    let count = 0n;
    for (let L = 1; L <= 45; L++) {
      const unit = 58n ** BigInt(L - 1);
      let a = d * unit, b = (d + 1n) * unit;
      if (a < LO) a = LO;
      if (b > TWO256) b = TWO256;
      if (b > a) count += b - a;
    }
    t.set(ALPHABET[Number(d)], Number((count * 10n ** 15n) / TWO256) / 1e15);
  }
  return t;
}
export const FIRST = firstCharTable();

// ---------- exact run probabilities ----------
// P(longest run of identical symbols >= k) in n iid uniform symbols over m letters.
const runCache = new Map();
export function pRunAtLeast(n, k, m = M) {
  if (k <= 1) return 1;
  if (k > n) return 0;
  const key = `${n},${k},${m}`;
  if (runCache.has(key)) return runCache.get(key);
  // state r = length of current run (1..k-1), absorbing when it reaches k
  let s = new Array(k).fill(0);
  s[1] = 1;
  let hit = 0;
  for (let i = 1; i < n; i++) {
    const t = new Array(k).fill(0);
    let total = 0;
    for (let r = 1; r < k; r++) total += s[r];
    t[1] = total * (m - 1) / m;
    for (let r = 1; r < k; r++) {
      if (r + 1 === k) hit += s[r] / m;
      else t[r + 1] += s[r] / m;
    }
    s = t;
  }
  runCache.set(key, hit);
  return hit;
}

// P(longest stretch of "successes" >= k) in n iid trials with success prob q.
const streakCache = new Map();
export function pStreakAtLeast(n, k, q) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  const key = `${n},${k},${q}`;
  if (streakCache.has(key)) return streakCache.get(key);
  let s = new Array(k).fill(0);
  s[0] = 1;
  let hit = 0;
  for (let i = 0; i < n; i++) {
    const t = new Array(k).fill(0);
    for (let r = 0; r < k; r++) {
      t[0] += s[r] * (1 - q);
      if (r + 1 === k) hit += s[r] * q;
      else t[r + 1] += s[r] * q;
    }
    s = t;
  }
  streakCache.set(key, hit);
  return hit;
}

const binom = (n, k) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};
// P(X >= d) and P(X <= d) for X ~ Binomial(n, q)
const binomUpper = (n, d, q) => { let s = 0; for (let k = d; k <= n; k++) s += binom(n, k) * q ** k * (1 - q) ** (n - k); return s; };
const binomLower = (n, d, q) => { let s = 0; for (let k = 0; k <= d; k++) s += binom(n, k) * q ** k * (1 - q) ** (n - k); return s; };

const poisson = (lambda) => -Math.expm1(-lambda);

// ---------- words ----------
const variants = (c) => [...new Set([c.toLowerCase(), c.toUpperCase()])].filter((v) => ALPHABET.includes(v));
const wordOdds = (w) => [...w].reduce((p, c) => p * variants(c).length / M, 1);
const wordFirst = (w) => variants(w[0]).reduce((s, v) => s + FIRST.get(v), 0) * wordOdds(w.slice(1));
const DICT = WORDS.filter((w) => w.length >= 4 && [...w].every((c) => variants(c).length));
// Sums per length, so a trait's odds are "any dictionary word this long or longer".
const byLen = new Map();
for (const w of DICT) {
  const e = byLen.get(w.length) || { any: 0, start: 0 };
  e.any += wordOdds(w);
  e.start += wordFirst(w);
  byLen.set(w.length, e);
}
const wordsAtLeast = (len, field, n) => {
  let lam = 0;
  for (const [L, e] of byLen) if (L >= len) lam += field === 'start' ? e.start : e.any * (n - L + 1);
  return poisson(lam);
};

// ---------- counting runs: 12345, 98765 ----------
function countingRun(a) {
  let best = null;
  for (let i = 0; i < a.length; i++) {
    if (!isDigit(a[i])) continue;
    for (const step of [1, -1]) {
      let j = i + 1;
      while (j < a.length && isDigit(a[j]) && +a[j] === +a[j - 1] + step) j++;
      const len = j - i;
      if (len >= 3 && (!best || len > best.len)) best = { len, i, j, step };
    }
  }
  return best;
}
const pCounting = (n, k) => poisson((n - k + 1) * 2 * (10 - k) * M ** -k);

// ---------- the scan ----------
// Returns { address, traits:[{id, label, detail, p, span}], score }.
export function analyze(input) {
  const a = String(input || '').trim();
  const check = classify(a);
  if (check.kind !== 'address') return { error: check };
  const n = a.length;
  const traits = [];
  const add = (t) => { if (t.p < 1) traits.push(t); };

  // 1. leading zero bytes
  const ones = a.match(/^1+/);
  if (ones) add({ id: 'zero', label: `Starts with ${ones[0].length > 1 ? ones[0].length + '× ' : ''}"1"`, detail: 'The key begins with a zero byte', p: 256 ** -ones[0].length, span: [0, ones[0].length] });

  // 2. same character at the start
  const lead = a.match(/^(.)\1+/);
  if (lead && lead[1] !== '1') {
    const k = lead[0].length;
    add({ id: 'lead', label: `Opens with ${k}× ${lead[1]}`, detail: `${lead[0]}…`, p: (1 - FIRST.get('1')) * M ** -(k - 1), span: [0, k] });
  }

  // 3. same character at the end
  const tail = a.match(/(.)\1+$/);
  if (tail) {
    const k = tail[0].length;
    add({ id: 'tail', label: `Ends with ${k}× ${tail[1]}`, detail: `…${tail[0]}`, p: M ** -(k - 1), span: [n - k, n] });
  }

  // 4. longest run in the middle
  let best = null;
  for (const m of a.matchAll(/(.)\1{2,}/g)) {
    if (m.index === 0 || m.index + m[0].length === n) continue;
    if (!best || m[0].length > best[0].length) best = m;
  }
  if (best) {
    const k = best[0].length;
    add({ id: 'run', label: `${k}× ${best[1]} in a row`, detail: best[0], p: pRunAtLeast(n - 2, k), span: [best.index, best.index + k] });
  }

  // 5. counting digits
  const cr = countingRun(a);
  if (cr) add({ id: 'count', label: `Counts ${a.slice(cr.i, cr.j)}`, detail: cr.step > 0 ? 'digits going up' : 'digits going down', p: pCounting(n, cr.len), span: [cr.i, cr.j] });

  // 6. long stretch of digits
  const ds = [...a.matchAll(/[1-9]+/g)].sort((x, y) => y[0].length - x[0].length)[0];
  if (ds && ds[0].length >= 5) add({ id: 'digits', label: `${ds[0].length} digits in a row`, detail: ds[0], p: pStreakAtLeast(n, ds[0].length, 9 / M), span: [ds.index, ds.index + ds[0].length] });

  // 7. how many digits overall
  const d = [...a].filter(isDigit).length;
  const pHi = binomUpper(n, d, 9 / M), pLo = binomLower(n, d, 9 / M);
  if (d === 0) add({ id: 'nodigit', label: 'No numbers at all', detail: `${n} characters, zero digits`, p: pLo });
  else if (pHi < 0.01) add({ id: 'manydigit', label: `${d} digits`, detail: `a typical address has about 7`, p: pHi });
  else if (pLo < 0.01) add({ id: 'fewdigit', label: `Only ${d} digit${d > 1 ? 's' : ''}`, detail: 'a typical address has about 7', p: pLo });

  // 8. words
  const lw = a.toLowerCase();
  let wStart = null, wAny = null;
  for (const w of DICT) {
    const i = lw.indexOf(w);
    if (i < 0) continue;
    if (i === 0 && (!wStart || w.length > wStart.w.length)) wStart = { w, i };
    if (!wAny || w.length > wAny.w.length) wAny = { w, i };
  }
  if (wStart && wStart.w.length >= 4) add({ id: 'wordstart', label: `Starts with "${a.slice(0, wStart.w.length)}"`, detail: 'a real word, any case', p: wordsAtLeast(wStart.w.length, 'start', n), span: [0, wStart.w.length] });
  else if (wAny) add({ id: 'word', label: `Hides the word "${a.slice(wAny.i, wAny.i + wAny.w.length)}"`, detail: 'a real word, any case', p: wordsAtLeast(wAny.w.length, 'any', n), span: [wAny.i, wAny.i + wAny.w.length] });

  // 9. echo: same opening and ending
  let echo = 0;
  while (echo < 8 && a[echo] === a[n - 1 - echo] && echo < n / 2) echo++;
  if (echo >= 2 && !(lead && tail && lead[1] === tail[1])) add({ id: 'mirror', label: `Mirrored ends`, detail: `${a.slice(0, echo)} … ${a.slice(n - echo)}`, p: M ** -echo });
  let rep = 0;
  for (let k = 6; k >= 2; k--) if (a.slice(0, k) === a.slice(n - k)) { rep = k; break; }
  if (rep >= 2 && !(lead && tail)) add({ id: 'echo', label: `Same start and end`, detail: `${a.slice(0, rep)} … ${a.slice(n - rep)}`, p: M ** -rep });

  // 10. a rare first letter
  if (!ones && FIRST.get(a[0]) < 0.002) add({ id: 'first', label: `Rare first letter "${a[0]}"`, detail: 'only 4% of addresses start with K to z', p: FIRST.get(a[0]) * 40 });

  // A digit stretch that is just a run or a count already listed is not a second trait.
  const covered = (sp) => traits.some((t) => t.id !== 'digits' && t.span && ['lead', 'tail', 'run', 'count', 'zero'].includes(t.id) && t.span[0] <= sp[0] && t.span[1] >= sp[1]);
  for (let i = traits.length - 1; i >= 0; i--) if (traits[i].id === 'digits' && covered(traits[i].span)) traits.splice(i, 1);

  // Digit traits overlap (many digits make long stretches likely), so only the rarest one counts.
  const dig = traits.filter((t) => t.id === 'digits' || t.id === 'manydigit');
  if (dig.length === 2) traits.splice(traits.indexOf(dig[0].p > dig[1].p ? dig[0] : dig[1]), 1);

  traits.sort((x, y) => x.p - y.p);
  // Score = rarity of the rarest trait, plus a small tie-breaker for the others.
  const logs = traits.map((t) => -Math.log10(t.p));
  const score = logs.length ? logs[0] + 0.05 * logs.slice(1).reduce((s, v) => s + v, 0) : 0;
  return { address: a, traits, score };
}

// Tell an address apart from things people should never paste.
export function classify(s) {
  if (!s) return { kind: 'empty' };
  const t = s.replace(/\s+/g, '');
  if (/^\[\s*\d+(\s*,\s*\d+){31,}\s*\]$/.test(s.trim())) return { kind: 'secret', why: 'This is a keypair file. It contains the private key.' };
  if (/^([a-z]+\s+){11,23}[a-z]+$/i.test(s.trim())) return { kind: 'secret', why: 'This looks like a seed phrase. It controls the wallet.' };
  if (/[^1-9A-HJ-NP-Za-km-z]/.test(t)) return { kind: 'invalid', why: 'Solana addresses only use base58: no 0, O, I or small l.' };
  if (t.length >= 80) return { kind: 'secret', why: 'This is the length of a private key, not an address.' };
  let bytes;
  try { bytes = decode(t); } catch { return { kind: 'invalid', why: 'Not valid base58.' }; }
  if (bytes.length === 64) return { kind: 'secret', why: 'This is a private key, not an address.' };
  if (bytes.length !== 32) return { kind: 'invalid', why: 'A Solana address decodes to 32 bytes.' };
  return { kind: 'address', bytes };
}

// ---------- ranking against random keys ----------
// cal = { n, scores: [[score, countAtLeast], ...] sorted by score ascending, tail: {c} }
export function rank(score, cal) {
  if (score <= 0) return { share: 1, oneIn: 1, beats: 0, extrapolated: false };
  const pts = cal.scores;
  let share;
  let extrapolated = false;
  const last = pts[pts.length - 1];
  if (score > last[0]) {
    share = Math.min(last[1] / cal.n, cal.tail.c * 10 ** -score);
    extrapolated = true;
  } else {
    let i = 0;
    while (i < pts.length && pts[i][0] < score) i++;
    share = pts[Math.min(i, pts.length - 1)][1] / cal.n;
  }
  return { share, oneIn: 1 / share, beats: 1 - share, extrapolated };
}

export const TIERS = [
  { name: 'Common', min: 1 },
  { name: 'Uncommon', min: 10 },
  { name: 'Rare', min: 100 },
  { name: 'Epic', min: 10000 },
  { name: 'Legendary', min: 1000000 },
  { name: 'Mythic', min: 100000000 },
];
export const tierOf = (oneIn) => [...TIERS].reverse().find((t) => oneIn >= t.min);
