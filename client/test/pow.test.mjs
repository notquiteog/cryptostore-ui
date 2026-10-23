/**
 * The proof-of-work hash must agree with the one the server verifies with.
 * powHash.js is our own SHA-256 (its header says why); Node's `crypto` is
 * what middleware/proofOfWork.js checks a proof against. If these two ever
 * disagree, every login on a store with the puzzle switched on fails, so
 * this pins them to each other on the exact shapes the puzzle produces.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sha256Hex, sha256Words, leadingZeroBits, searchCounter } from '../src/utils/powHash.js';

const enc = new TextEncoder();
const nodeHex = (s) => createHash('sha256').update(s).digest('hex');

// A copy of the server's count (middleware/proofOfWork.js `leadingZeroBits`),
// over bytes, so the test does not have to load a module that opens a
// database pool.
function serverLeadingZeroBits(buf) {
  let n = 0;
  for (const byte of buf) {
    if (byte === 0) { n += 8; continue; }
    n += Math.clz32(byte) - 24;
    break;
  }
  return n;
}
const serverSolves = (nonce, counter, bits) =>
  serverLeadingZeroBits(createHash('sha256').update(`${nonce}:${counter}`).digest()) >= bits;

test('sha256 matches node on the edges of the padding and on random input', () => {
  const cases = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(57), 'a'.repeat(63),
    'a'.repeat(64), 'a'.repeat(65), 'a'.repeat(119), 'a'.repeat(120), 'a'.repeat(121), 'a'.repeat(1000)];
  for (let i = 0; i < 400; i++) cases.push(randomBytes(1 + (i % 130)).toString('base64url'));
  for (const s of cases) {
    assert.equal(sha256Hex(enc.encode(s)), nodeHex(s), `input of length ${s.length}`);
  }
});

test('sha256 scratch buffers carry nothing between calls', () => {
  // A long message then a short one: the padded copy is reused, and a stale
  // byte past the short message's end would change its digest.
  sha256Hex(enc.encode('x'.repeat(500)));
  assert.equal(sha256Hex(enc.encode('abc')), nodeHex('abc'));
});

test('leading zero bits agree with the server\'s count over bytes', () => {
  let sawSome = 0;
  for (let i = 0; i < 4000; i++) {
    const s = `probe.${i}`;
    const ours = leadingZeroBits(sha256Words(enc.encode(s)));
    const theirs = serverLeadingZeroBits(createHash('sha256').update(s).digest());
    assert.equal(ours, theirs, s);
    if (ours >= 8) sawSome++;
  }
  // Sanity: with 4000 probes, roughly 16 should clear a byte of zeros. If
  // none did, the count is not counting.
  assert.ok(sawSome > 0);
});

test('searchCounter finds the first counter the server accepts, as digits it will parse', () => {
  const nonce = `login.12.${Date.now() + 300000}.abcDEF123456.${'m'.repeat(27)}`;
  const bits = 12;
  let hit = null;
  for (let from = 0; hit == null; from += 1024) hit = searchCounter(nonce, bits, from, from + 1024);
  assert.ok(serverSolves(nonce, hit, bits), `server rejects counter ${hit}`);
  for (let c = 0; c < hit; c++) assert.ok(!serverSolves(nonce, c, bits), `counter ${c} solved before ${hit}`);
  assert.match(String(hit), /^\d{1,12}$/);
});

test('searchCounter reports an empty range as null, not as a solution', () => {
  assert.equal(searchCounter('nonce', 26, 0, 8), null);
  assert.equal(searchCounter('nonce', 0, 5, 6), 5);
});
