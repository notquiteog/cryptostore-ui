/**
 * The audit page's translation layer knows about sign-ins.
 *
 *   cd client && node --test test/auditActions.test.mjs
 *
 * `auth.login` is the first action logged under a prefix the page had never
 * seen. An unknown prefix does not break the page — it files under "Other"
 * with a humanised label — which is precisely why a test is needed: the
 * failure is a chip that never appears and a row that reads "Login" in grey,
 * and nobody would report either as a bug.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIT_FAMILIES, UNFILED_FAMILY, familyOf, severityOf, labelOf,
} from '../src/utils/auditActions.js';

test('a sign-in files under Sign-ins, not Other', () => {
  assert.equal(familyOf('auth.login').key, 'signins');
  assert.notEqual(familyOf('auth.login'), UNFILED_FAMILY);
});

test('the Sign-ins chip owns the auth prefix, and nothing else claims it', () => {
  const owners = AUDIT_FAMILIES.filter((f) => f.prefixes.includes('auth.'));
  assert.deepEqual(owners.map((f) => f.key), ['signins']);
});

test('a recovery-code sign-in is the one that lights up', () => {
  // The authenticator is gone or the printed sheet is in somebody's hands —
  // either is worth an amber row. An ordinary sign-in is how every working
  // day starts and stays quiet, which is the whole value of the severity list.
  assert.equal(severityOf('auth.login', { method: 'password' }), 'routine');
  assert.equal(severityOf('auth.login', { method: 'totp' }), 'routine');
  assert.equal(severityOf('auth.login', { method: 'pgp' }), 'routine');
  assert.equal(severityOf('auth.login', { method: 'recovery_code' }), 'notable');
  // A row with no payload — an older or hand-written one — is graded quiet
  // rather than thrown on.
  assert.equal(severityOf('auth.login'), 'routine');
});

test('the label names the event rather than the bare verb', () => {
  assert.equal(labelOf('auth.login'), 'Signed in');
});

test('no prefix is claimed by two families', () => {
  // Two chips claiming one prefix would double-count it in the chip totals
  // and make the family filter return the same rows under either.
  const all = AUDIT_FAMILIES.flatMap((f) => f.prefixes);
  assert.deepEqual(all.filter((p, i) => all.indexOf(p) !== i), []);
});
