/**
 * Bounded, in-memory history for the theme workbench. A slider emits dozens of
 * values per gesture; consecutive edits to the same fields share one undo step
 * so Undo returns to the colour before the drag, not the previous pixel.
 * Nothing here is persisted: only the explicit Save action owns persistence.
 */
export const createThemeDraft = (present) => ({ present, past: [], future: [], group: null, time: 0 });

export function themeDraftReducer(state, action) {
  if (action.type === 'load') return createThemeDraft(action.value);
  if (action.type === 'undo') {
    if (!state.past.length) return state;
    return { ...state, present: state.past.at(-1), past: state.past.slice(0, -1),
      future: [state.present, ...state.future], group: null };
  }
  if (action.type === 'redo') {
    if (!state.future.length) return state;
    return { ...state, present: state.future[0], past: [...state.past, state.present],
      future: state.future.slice(1), group: null };
  }
  // Saving ends a gesture without removing history. Undo after Save creates a
  // new unsaved draft, and Discard can still return to the last saved snapshot.
  if (action.type === 'checkpoint') return { ...state, group: null };
  if (action.type !== 'edit') return state;
  const keys = Object.keys(action.value).filter((k) => action.value[k] !== state.present[k]);
  if (!keys.length) return state;
  const group = keys.length === 1 ? keys[0] : null;
  const coalesce = group && group === state.group && action.time - state.time < 600 && !state.future.length;
  return { present: action.value, past: coalesce ? state.past : [...state.past, state.present].slice(-80),
    future: [], group, time: action.time };
}

export function themeChanges(base, value, keys = Object.keys(value)) {
  return Object.fromEntries(keys.filter(k => String(base[k] ?? '') !== String(value[k] ?? '')).map(k => [k, value[k]]));
}
// Preserve non-overlapping edits; overlapping edits require a visible choice.
export function mergeThemeDraft(base, local, published, choices = {}) {
  const edits = themeChanges(base, local);
  const conflicts = Object.keys(edits).filter(k => String(base[k] ?? '') !== String(published[k] ?? '') && String(local[k] ?? '') !== String(published[k] ?? ''));
  const merged = { ...published, ...edits };
  for (const key of conflicts) if (choices[key] === 'published') merged[key] = published[key];
  return { merged, conflicts };
}
