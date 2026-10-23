/**
 * The Code 128 encoder, checked against the spec rather than against itself.
 *
 * A barcode that scans as a different string from the one printed under it
 * is worse than no barcode, and the two ways that happens are a wrong pattern
 * table and a wrong checksum. Both are checked here by DECODING the module
 * widths back with an independent walk of the table, and by comparing the
 * checksum with a hand-computed reference for a known string.
 *
 * Run with the rest of the suite: `npm test`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encode, gradientStops, encodable, CODE128_PATTERNS, QUIET_ZONE } from '../src/utils/code128.js';

/** Walk the widths back into symbol values, or throw where the table has no match. */
function decode(widths) {
  const inner = widths.slice(1, -1); // strip the quiet zones
  const symbols = [];
  let i = 0;
  while (i < inner.length) {
    const len = i + 7 <= inner.length && inner.slice(i, i + 7).join('') === CODE128_PATTERNS[106] ? 7 : 6;
    const pat = inner.slice(i, i + len).join('');
    const sym = CODE128_PATTERNS.indexOf(pat);
    assert.notEqual(sym, -1, `no symbol has the pattern ${pat} at offset ${i}`);
    symbols.push(sym);
    i += len;
  }
  return symbols;
}

test('every symbol pattern is six modules wide, eleven units, and the stop is thirteen', () => {
  // The invariants of the symbology: each data symbol has three bars and
  // three spaces summing to 11 modules; bars are odd positions, so the sum of
  // the odd digits is even and the sum of the even digits is odd.
  for (let i = 0; i < 106; i++) {
    const p = CODE128_PATTERNS[i];
    assert.equal(p.length, 6, `symbol ${i}`);
    const digits = [...p].map(Number);
    assert.equal(digits.reduce((s, d) => s + d, 0), 11, `symbol ${i} is not 11 modules`);
    const bars = digits[0] + digits[2] + digits[4];
    assert.equal(bars % 2, 0, `symbol ${i} has an odd bar total`);
  }
  assert.equal(CODE128_PATTERNS[106], '2331112');
  assert.equal(new Set(CODE128_PATTERNS).size, 107, 'a pattern is duplicated');
});

test('a known string encodes with the reference checksum', () => {
  // "PJJ123C": Start B (104), then P J J 1 2 3 C = 48 42 42 17 18 19 35.
  // Checksum = (104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7) mod 103
  //          = 879 mod 103 = 55, written out so the reference is the spec's
  //          formula and not a number remembered from somewhere.
  const { widths } = encode('PJJ123C');
  const symbols = decode(widths);
  assert.deepEqual(symbols, [104, 48, 42, 42, 17, 18, 19, 35, 879 % 103, 106]);
});

test('round-trips every printable ASCII character', () => {
  let all = '';
  for (let c = 32; c <= 126; c++) all += String.fromCharCode(c);
  const { widths, total } = encode(all);
  const symbols = decode(widths);
  assert.equal(symbols[0], 104);
  assert.equal(symbols[symbols.length - 1], 106);
  const data = symbols.slice(1, -2).map((v) => String.fromCharCode(v + 32)).join('');
  assert.equal(data, all);
  // Checksum recomputed independently.
  let sum = 104;
  symbols.slice(1, -2).forEach((v, i) => { sum += v * (i + 1); });
  assert.equal(symbols[symbols.length - 2], sum % 103);
  assert.equal(total, widths.reduce((s, w) => s + w, 0));
  assert.equal(widths[0], QUIET_ZONE);
  assert.equal(widths[widths.length - 1], QUIET_ZONE);
});

test('the order reference and box tag shapes the store prints encode', () => {
  assert.ok(encodable('3F2A9C1E'));
  assert.ok(encodable('3F2A9C1E-2'));
  assert.ok(encodable('SUMMER-20'));
  assert.equal(encodable(''), false);
  assert.equal(encodable('café'), false);
  assert.throws(() => encode('é'));
});

test('gradient stops cover exactly the whole width', () => {
  const { stops, modules } = gradientStops('ABC');
  assert.equal(modules, encode('ABC').total);
  assert.match(stops, /^transparent 0\.000% /);
  assert.match(stops, / 100\.000%$/);
  // Bars and spaces alternate, starting with the quiet zone.
  const kinds = stops.split(',').map((s) => s.split(' ')[0]);
  kinds.forEach((k, i) => assert.equal(k, i % 2 === 0 ? 'transparent' : 'currentColor'));
});
