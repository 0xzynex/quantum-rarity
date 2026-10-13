// Rank table: score 2,000,000 random public keys and store how many reach each score.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { encode } from '../src/base58.js';
import { analyze } from '../src/rarity.js';

const N = +(process.argv[2] || 2000000);
const scores = new Float64Array(N);
const t0 = Date.now();
const buf = randomBytes(32 * 65536);
let off = 0, pool = buf;
for (let i = 0; i < N; i++) {
  if (off + 32 > pool.length) { pool = randomBytes(32 * 65536); off = 0; }
  const a = encode(pool.subarray(off, off + 32)); off += 32;
  scores[i] = analyze(a).score;
  if (i % 200000 === 0) process.stderr.write(`${i} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}
scores.sort();
// thresholds: log-spaced in "share at least", from 1 down to ~20/N
const table = [];
const desc = Array.from(scores).reverse();
const zeros = desc.filter((s) => s === 0).length;
let lastScore = -1;
for (let k = 0; k <= 400; k++) {
  const count = Math.max(1, Math.round(N * 10 ** (-k / 40)));
  if (count < 20) break;
  const s = desc[count - 1];
  if (s === lastScore || s === 0) continue;
  // count of keys with score >= s
  let c = 0; while (c < N && desc[c] >= s) c++;
  table.push([+s.toFixed(4), c]);
  lastScore = s;
}
table.sort((x, y) => x[0] - y[0]);
// Tail constant: share(score>=s) ~ c * 10^-s, fit on the rarest well-populated points
const fit = table.filter(([, c]) => c >= 20 && c <= 2000);
const cs = fit.map(([s, c]) => (c / N) / 10 ** -s);
const c = cs.sort((x, y) => x - y)[Math.floor(cs.length / 2)];
writeFileSync(new URL('../data/calibration.json', import.meta.url), JSON.stringify({ n: N, plain: zeros, scores: table, tail: { c: +c.toFixed(3) } }));
console.log('N', N, 'plain', zeros, 'points', table.length, 'tail c', c, 'top', table.slice(-5), 'time', (Date.now() - t0) / 1000);
