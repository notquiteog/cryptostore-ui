import test from 'node:test';
import assert from 'node:assert/strict';
import { createCartLoader } from '../src/utils/cartLoader.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  let userId = 1, state = {}, reads = [];
  const load = createCartLoader({ currentUserId: () => userId, update: patch => { state = { ...state, ...patch }; }, read: () => { const d = deferred(); reads.push(d); return d.promise; } });
  return { load, reads, user: id => { userId = id; }, state: () => state };
}
test('an older cart response cannot overwrite a newer edit', async () => {
  const f = fixture(); const older = f.load(1), newer = f.load(1);
  f.reads[1].resolve([{ quantity: 3 }]); await newer;
  f.reads[0].resolve([{ quantity: 1 }]); await older;
  assert.deepEqual(f.state().items, [{ quantity: 3 }]); assert.equal(f.state().loading, false);
});
test('a stale failure cannot empty a successfully refreshed cart', async () => {
  const f = fixture(); const older = f.load(1), newer = f.load(1);
  f.reads[1].resolve([{ quantity: 2 }]); await newer;
  f.reads[0].reject(new Error('old failure')); await older;
  assert.deepEqual(f.state().items, [{ quantity: 2 }]); assert.equal(f.state().error, null);
});
test('signing out drops an in-flight cart response', async () => {
  const f = fixture(); const pending = f.load(1); f.user(null); await f.load(null);
  f.reads[0].resolve([{ private: true }]); await pending;
  assert.deepEqual(f.state(), { items: [], error: null, hydrated: false, loading: false });
});
test('an old account response and callback cannot alter another account cart', async () => {
  const f = fixture(); const older = f.load(1); f.user(2); const newer = f.load(2);
  f.reads[1].resolve([{ owner: 2 }]); await newer;
  f.reads[0].resolve([{ owner: 1 }]); await older; await f.load(1);
  assert.deepEqual(f.state().items, [{ owner: 2 }]); assert.equal(f.reads.length, 2);
});

test('switching accounts clears the old cart before the next response arrives', async () => {
 const f = fixture(); const first = f.load(1); f.reads[0].resolve([{ owner: 1 }]); await first;
 f.user(2); const second = f.load(2);
 assert.deepEqual(f.state().items, []); assert.equal(f.state().hydrated, false);
 f.reads[1].resolve([{ owner: 2 }]); await second;
 assert.deepEqual(f.state().items, [{ owner: 2 }]);
});
