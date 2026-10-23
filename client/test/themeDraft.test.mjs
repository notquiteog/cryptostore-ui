import test from 'node:test';
import assert from 'node:assert/strict';
import { createThemeDraft, themeDraftReducer as reduce } from '../src/theme/draft.js';
const edit = (state, value, time) => reduce(state, { type: 'edit', value, time });

test('continuous slider edits undo as one gesture and redo the final value', () => {
  let state = createThemeDraft({ glow: '1', radius: '14' });
  state = edit(state, { ...state.present, glow: '1.1' }, 1000);
  state = edit(state, { ...state.present, glow: '1.2' }, 1100);
  state = edit(state, { ...state.present, glow: '1.8' }, 1200);
  assert.equal(state.past.length, 1);
  state = reduce(state, { type: 'undo' });
  assert.equal(state.present.glow, '1');
  state = reduce(state, { type: 'redo' });
  assert.equal(state.present.glow, '1.8');
});

test('different fields, presets and pauses form separate steps; branching drops redo', () => {
  let state = createThemeDraft({ a: '1', b: '1' });
  state = edit(state, { a: '2', b: '1' }, 1000);
  state = edit(state, { a: '3', b: '1' }, 2000);
  state = edit(state, { a: '3', b: '2' }, 2050);
  state = edit(state, { a: '4', b: '4' }, 2100);
  assert.equal(state.past.length, 4);
  state = reduce(state, { type: 'undo' });
  assert.deepEqual(state.present, { a: '3', b: '2' });
  state = edit(state, { a: '5', b: '2' }, 2200);
  assert.equal(state.future.length, 0);
});

test('save checkpoint splits a gesture without losing undo; loading clears history', () => {
  let state = edit(createThemeDraft({ a: '1' }), { a: '2' }, 1000);
  state = reduce(state, { type: 'checkpoint' });
  state = edit(state, { a: '3' }, 1010);
  assert.equal(reduce(state, { type: 'undo' }).present.a, '2');
  state = reduce(state, { type: 'load', value: { a: '4' } });
  assert.equal(state.past.length, 0);
  assert.equal(reduce(state, { type: 'undo' }), state);
});

test('history stays bounded and no-op changes do not add steps', () => {
  let state = createThemeDraft({ a: '0' });
  for (let n = 1; n <= 100; n++) state = edit(state, { a: String(n) }, n * 1000);
  assert.equal(state.past.length, 80);
  assert.equal(edit(state, { a: '100' }, 101000), state);
});
