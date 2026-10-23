import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  PRESET_FAMILIES, familyLabel, presetEffectsOn, presetMaterialLabel,
} from '../../theme/presets';

/**
 * The preset gallery: fifty looks, findable.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The gallery was `presetList.map(PresetCard)` into one auto-fill grid, and
 * that was the right shape for eight presets and a defensible one for
 * twenty-two. At fifty it stops being a choice and becomes a wall: three
 * screens of swatch cards in a fixed order nobody can hold in their head, so
 * the only way to find the look you half-remember is to scroll past everything
 * else and hope you recognise it. That is the failure DESIGN §7 describes —
 * density without a way in — and it does not get better by making the cards
 * smaller.
 *
 * Two ways in, because operators arrive with two different kinds of memory:
 *
 *   - **The family**, for somebody who knows what KIND of store they run but
 *     not which of fifty proper nouns matches it. "Machine" and "Print" are
 *     questions an operator can answer; "Substrate or Riso?" is not.
 *   - **A search**, for somebody who remembers a word — the name, something
 *     from the description, "gold", "no glass", the name of an effect. It
 *     matches the description and the chips too, not just the label, because
 *     "the one with the fog" is how people actually remember these.
 *
 * ── Grouped, not paginated ────────────────────────────────────────────────
 *
 * Every preset stays on the page at all times when no filter is on; the
 * families are headings within one scroll rather than pages to click through.
 * Paging would hide the thing that makes a roster worth having, which is that
 * you can see the range at a glance — and it would put the operator's own
 * presets, the ones they are most likely to want, on page three.
 *
 * When a search or a single family is active the headings collapse to one flat
 * grid: at that point the grouping is answering a question nobody asked, and
 * a single heading over a single group is furniture.
 */

/** Everything about a preset a search should be able to reach. */
function haystack(p) {
  return [
    p.label,
    p.description,
    familyLabel(p.family),
    presetMaterialLabel(p),
    ...presetEffectsOn(p),
    // The shader a preset runs is a real thing an operator remembers it by,
    // and it is otherwise unreachable — the card shows "background shader on",
    // never which one.
    p.settings?.effects_shader === 'true' ? p.settings.effects_shader_name : '',
    p.settings?.effects_header_shader === 'true' ? p.settings.effects_header_shader_name : '',
    p.builtin ? '' : 'mine yours custom',
  ].filter(Boolean).join(' ').toLowerCase();
}

export default function PresetGallery({ presets, renderCard }) {
  const [family, setFamily] = useState('all');
  const [query, setQuery] = useState('');

  const indexed = useMemo(
    () => presets.map((p) => ({ preset: p, text: haystack(p) })),
    [presets],
  );

  // Counts come from the UNFILTERED list, so a chip always says how many
  // presets that family holds rather than how many survive the current search.
  // A row of chips that all read "0" while you type is a row of dead controls.
  const counts = useMemo(() => {
    const out = { all: presets.length, custom: 0 };
    for (const p of presets) {
      const key = p.builtin ? (p.family || 'other') : 'custom';
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  }, [presets]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => indexed
    .filter(({ preset, text }) => {
      if (family !== 'all') {
        const key = preset.builtin ? (preset.family || 'other') : 'custom';
        if (key !== family) return false;
      }
      return !q || text.includes(q);
    })
    .map(({ preset }) => preset), [indexed, family, q]);

  const grouped = family === 'all' && !q;

  const groups = useMemo(() => {
    if (!grouped) return null;
    const out = [];
    for (const f of PRESET_FAMILIES) {
      const items = visible.filter((p) => p.builtin && p.family === f.id);
      if (items.length) out.push({ ...f, items });
    }
    // A built-in whose family this build does not know still has to appear, or
    // adding a preset and forgetting its family would silently delete it from
    // the page — which is a far worse failure than an odd heading.
    const known = new Set(PRESET_FAMILIES.map((f) => f.id));
    const orphans = visible.filter((p) => p.builtin && !known.has(p.family));
    if (orphans.length) {
      out.push({ id: 'other', label: 'Other', hint: 'Built-ins with no family declared.', items: orphans });
    }
    const mine = visible.filter((p) => !p.builtin);
    if (mine.length) {
      out.push({ id: 'custom', label: 'Yours', hint: 'Presets you captured from the editor.', items: mine });
    }
    return out;
  }, [grouped, visible]);

  const chips = [
    { id: 'all', label: 'All' },
    ...PRESET_FAMILIES,
    ...(counts.custom ? [{ id: 'custom', label: 'Yours', hint: 'Presets you captured from the editor.' }] : []),
  ];

  return (
    <div className="pg">
      <div className="pg-filters">
        <div className="pg-chips" role="radiogroup" aria-label="Filter presets by family">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={family === c.id}
              className={`pg-chip${family === c.id ? ' is-on' : ''}`}
              onClick={() => setFamily(c.id)}
              title={c.hint}
            >
              {c.label}
              <span className="pg-chip-count">{counts[c.id] || 0}</span>
            </button>
          ))}
        </div>
        <div className="pg-search">
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a look — name, mood, material, effect…"
            aria-label="Search presets"
          />
          {query && (
            <button type="button" className="pg-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        // Names what was searched and offers the way back, rather than an
        // empty grid that reads as a broken page.
        <p className="pg-empty">
          Nothing matches <strong>{query || familyLabel(family) || family}</strong>.
          {' '}
          <button type="button" className="pg-linkish" onClick={() => { setQuery(''); setFamily('all'); }}>
            Show all {presets.length}
          </button>
        </p>
      ) : grouped ? (
        groups.map((g) => (
          <section key={g.id} className="pg-group">
            <h3 className="pg-group-head">
              {g.label}
              <span className="pg-group-count">{g.items.length}</span>
              <span className="pg-group-hint">{g.hint}</span>
            </h3>
            <div className="preset-grid">{g.items.map(renderCard)}</div>
          </section>
        ))
      ) : (
        <div className="preset-grid">{visible.map(renderCard)}</div>
      )}
    </div>
  );
}
