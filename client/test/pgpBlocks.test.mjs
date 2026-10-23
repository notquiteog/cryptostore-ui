/**
 * Splitting free text into prose and PGP MESSAGE blocks (src/utils/pgpBlocks.js).
 *
 * The cases are the ones that decide whether a ticket renders sanely: a
 * block with prose either side, two blocks, a block that is the whole
 * message, a truncated block (no END line — not a block), and the other
 * armor kinds, which must NOT be offered a decrypt button.
 *
 * Run with the rest of the suite: `npm test`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { splitMessageBlocks, hasMessageBlock } from '../src/utils/pgpBlocks.js';

const BLOCK = '-----BEGIN PGP MESSAGE-----\n\nhQEMA+abc\n=ABCD\n-----END PGP MESSAGE-----';
const SIGNED = '-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\nhello\n-----BEGIN PGP SIGNATURE-----\n\nabc\n-----END PGP SIGNATURE-----';
const PUBKEY = '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmQEN\n-----END PGP PUBLIC KEY BLOCK-----';

test('plain text is one text segment, untouched', () => {
  assert.deepEqual(splitMessageBlocks('Hello there'), [{ type: 'text', value: 'Hello there' }]);
  assert.deepEqual(splitMessageBlocks(''), [{ type: 'text', value: '' }]);
  assert.equal(hasMessageBlock('Hello there'), false);
});

test('a block with prose either side splits into three, blank framing lines dropped', () => {
  const parts = splitMessageBlocks(`Here is my address again:\n\n${BLOCK}\n\nThanks!`);
  assert.deepEqual(parts, [
    { type: 'text', value: 'Here is my address again:' },
    { type: 'block', value: BLOCK },
    { type: 'text', value: 'Thanks!' },
  ]);
  assert.equal(hasMessageBlock(parts.map((p) => p.value).join('\n')), true);
});

test('a message that is only a block is one block segment', () => {
  assert.deepEqual(splitMessageBlocks(BLOCK), [{ type: 'block', value: BLOCK }]);
  assert.deepEqual(splitMessageBlocks(`  \n${BLOCK}\n  `), [{ type: 'block', value: BLOCK }]);
});

test('two blocks are two blocks, in order', () => {
  const parts = splitMessageBlocks(`${BLOCK}\nand the second one\n${BLOCK}`);
  assert.deepEqual(parts.map((p) => p.type), ['block', 'text', 'block']);
  assert.equal(parts[1].value, 'and the second one');
});

test('a block with no END line is not a block', () => {
  const cut = '-----BEGIN PGP MESSAGE-----\n\nhQEMA+abc\n=ABCD\n';
  assert.deepEqual(splitMessageBlocks(cut), [{ type: 'text', value: cut }]);
  assert.equal(hasMessageBlock(cut), false);
});

test('signed messages and public keys are not offered as decryptable', () => {
  assert.equal(hasMessageBlock(SIGNED), false);
  assert.equal(hasMessageBlock(PUBKEY), false);
  assert.deepEqual(splitMessageBlocks(SIGNED).map((p) => p.type), ['text']);
});

test('the stateful regex does not remember the previous call', () => {
  // A global regex with lastIndex left over from one test would skip the
  // start of the next string. Same input twice, same answer twice.
  assert.equal(hasMessageBlock(BLOCK), true);
  assert.equal(hasMessageBlock(BLOCK), true);
  assert.equal(splitMessageBlocks(BLOCK).length, 1);
  assert.equal(splitMessageBlocks(BLOCK).length, 1);
});
