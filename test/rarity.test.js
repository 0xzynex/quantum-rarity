import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { encode } from '../src/base58.js';
import { analyze, classify, FIRST, pRunAtLeast, pStreakAtLeast, rank, tierOf } from '../src/rarity.js';
import cal from '../data/calibration.json' with { type: 'json' };

const randomAddress = () => encode(randomBytes(32));

test('first-character table sums to 1 and matches the known split', () => {
  const sum = [...FIRST.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(Math.abs(1 / FIRST.get('z') - 999.3) < 1);
  assert.ok(Math.abs(1 / FIRST.get('H') - 16.94) < 0.05);
});

test('run DP matches brute force on a tiny alphabet', () => {
  // n=4, m=2, P(run of 3+) = 6/16 (0001 is not; count by enumeration)
  let hits = 0;
  for (let x = 0; x < 16; x++) {
    const s = x.toString(2).padStart(4, '0');
    if (/(.)\1\1/.test(s)) hits++;
  }
  assert.equal(pRunAtLeast(4, 3, 2), hits / 16);
  // streak of successes: n=4, q=.5, at least 2 ones in a row
  let h2 = 0;
  for (let x = 0; x < 16; x++) if (/11/.test(x.toString(2).padStart(4, '0'))) h2++;
  assert.equal(pStreakAtLeast(4, 2, 0.5), h2 / 16);
});

test('trait odds match 300,000 random keys', () => {
  const N = 300000;
  const seen = { tail: 0, lead: 0, zero: 0, first: 0, run: 0 };
  let expect = { tail: 0, lead: 0, zero: 0, first: 0, run: 0 };
  for (let i = 0; i < N; i++) {
    const r = analyze(randomAddress());
    for (const t of r.traits) {
      if (t.id in seen) seen[t.id]++;
    }
  }
  // class probabilities for "at least one" of each family
  expect.tail = N / 58;                 // last two the same
  expect.lead = N * (1 - 1 / 256) / 58; // first two the same, not "1"
  expect.zero = N / 256;
  expect.first = N * 40 * FIRST.get('z');
  expect.run = N * pRunAtLeast(42, 3);
  for (const k of Object.keys(seen)) {
    const sd = Math.sqrt(expect[k]);
    assert.ok(Math.abs(seen[k] - expect[k]) < 5 * sd, `${k}: saw ${seen[k]}, expected ${expect[k].toFixed(0)}`);
  }
});

test('real ed25519 keys behave the same', () => {
  let rareFirst = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const der = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' });
    const a = encode(der.subarray(der.length - 32));
    if (FIRST.get(a[0]) < 0.002) rareFirst++;
  }
  const e = N * 40 * FIRST.get('z');
  assert.ok(Math.abs(rareFirst - e) < 5 * Math.sqrt(e));
});

test('known addresses get the traits a person would see', () => {
  const z = analyze('ZYNexSFaVhb3az3pW9FxL8TCfjsohXwDbkyRd6rW4sJ');
  assert.ok(z.traits.some((t) => t.id === 'wordstart'));
  const n = analyze('999999ynKbVVVro1wETRuYBgdyzrPDcixxkgGVyKRuwX');
  assert.equal(n.traits[0].id, 'lead');
  assert.ok(!n.traits.some((t) => t.id === 'digits'), 'the 999999 run is not counted twice');
  const t = analyze('CAZFUqBW3PbS6MTxHjo28y8AK8FwQBC61WBUQjM77777');
  assert.equal(t.traits[0].id, 'tail');
});

test('never accepts a private key or seed phrase', () => {
  const kp = generateKeyPairSync('ed25519');
  const seed = kp.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const pub = kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const secret = encode(Buffer.concat([seed, pub]));
  assert.equal(classify(secret).kind, 'secret');
  assert.equal(classify(JSON.stringify([...seed, ...pub])).kind, 'secret');
  assert.equal(classify('word '.repeat(11) + 'word').kind, 'secret');
  assert.equal(classify('0xdeadbeef').kind, 'invalid');
  assert.equal(classify(encode(pub)).kind, 'address');
});

test('ranking is monotone and the tail is calibrated', () => {
  let prev = 1;
  for (let s = 0.5; s < 12; s += 0.25) {
    const r = rank(s, cal);
    assert.ok(r.share <= prev + 1e-12);
    prev = r.share;
  }
  assert.ok(cal.tail.c > 1 && cal.tail.c < 10);
  assert.equal(tierOf(1).name, 'Common');
  assert.equal(tierOf(5e6).name, 'Legendary');
});
