import { LayoutGrid, Rows3 } from 'lucide-react';

/**
 * The cards / rows switch that sits in a list's toolbar.
 *
 * Pairs with `hooks/useViewMode.js`; see that file for why one module owns
 * this instead of each surface re-deriving it. This half is the control, and
 * it exists so the *markup* cannot drift either — the three hand-rolled
 * copies had three different label pairs ("Cards/List", "Cards/Compact",
 * "Cards/List" again) and two different class vocabularies, so the same
 * control looked and read differently depending on which page you were on.
 *
 * Built on `.segmented` / `.segmented-option` from 23-switch.css rather than a
 * new class family: that pair is already the house segmented control, already
 * has its focus-visible ring in the motion layer, and already sits on the
 * `--control-h` baseline every toolbar around it uses.
 *
 * The word beside each icon is hidden on narrow toolbars, never the icon —
 * `aria-label` on the group and `aria-pressed` on each half carry the meaning
 * for anyone the icons do not.
 */
export default function ViewToggle({
  value,
  onChange,
  label = 'Layout',
  cardsLabel = 'Cards',
  rowsLabel = 'Rows',
}) {
  return (
    <div className="segmented view-toggle" role="group" aria-label={label}>
      <button
        type="button"
        className={`segmented-option${value === 'cards' ? ' active' : ''}`}
        aria-pressed={value === 'cards'}
        onClick={() => onChange('cards')}
      >
        <LayoutGrid size={14} aria-hidden="true" />
        <span className="view-toggle-word">{cardsLabel}</span>
      </button>
      <button
        type="button"
        className={`segmented-option${value === 'rows' ? ' active' : ''}`}
        aria-pressed={value === 'rows'}
        onClick={() => onChange('rows')}
      >
        <Rows3 size={14} aria-hidden="true" />
        <span className="view-toggle-word">{rowsLabel}</span>
      </button>
    </div>
  );
}
