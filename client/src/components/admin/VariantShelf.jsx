import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Check, TriangleAlert, ClipboardCheck, PackageSearch } from 'lucide-react';
import { api } from '../../utils/api';

/**
 * What the shelf says about one variant, next to the field that files it.
 *
 * ── What this replaced ──────────────────────────────────────────────────────
 *
 * A multi-row editor: add a shelf, star one as the pick face, type a quantity
 * per shelf, move units between them. It was withdrawn because it described a
 * warehouse the rest of the system would not honour — `bin_location` is a
 * single column, and the pull list, the pack bench, `BinChip` and the slot
 * grid all read exactly that one bin. An operator could record stock across
 * three shelves and every screen that sends somebody walking would still send
 * them to one of them. Stores that had split a variant had the units summed
 * onto the bin they were already picking from, with the discarded bins named
 * in that row's note so nothing was silently destroyed.
 *
 * ── Why this is a readout and not an editor ─────────────────────────────────
 *
 * The shelf CODE is edited by the plain field above this panel, which now
 * writes through the same service the stock events do, so there is exactly one
 * way to say where a variant lives.
 *
 * The recorded QUANTITY is deliberately not editable here. Correcting it is
 * counting, counting produces an audit row, and an editor that let somebody
 * retype the figure would be a second way to adjust stock with no record of
 * who did it or what they saw on the shelf — precisely the reconciliation the
 * counting screen exists to make deliberate. So the gap is reported and the
 * panel links to the screen that can settle it.
 */
export default function VariantShelf({ variantId }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!variantId) return;
    setLoading(true);
    try {
      const res = await api.get(`/stock/variants/${variantId}/locations`);
      setState({
        bin: res.location?.bin_location || null,
        shelved: res.shelved ?? 0,
        onHand: res.variant?.quantity ?? 0,
        gap: res.gap ?? 0,
      });
    } catch {
      // A shelf readout that cannot load is not worth an error toast on a
      // product form somebody is in the middle of editing.
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [variantId]);

  useEffect(() => { load(); }, [load]);

  if (!variantId) return null;
  if (loading) return <div className="vloc"><span className="vloc-loading">Reading the shelf…</span></div>;
  if (!state) return null;

  const { bin, shelved, onHand, gap } = state;

  return (
    <div className="vloc">
      <header className="vloc-head">
        <span className="vloc-title">
          <MapPin size={13} aria-hidden="true" />
          {bin ? <>Filed at <code className="vloc-bin-code">{bin}</code></> : 'Not on a shelf'}
        </span>

        {bin && (
          <span className={`vloc-gap${gap !== 0 ? ' is-off' : ''}`}>
            {gap === 0 ? (
              <><Check size={12} aria-hidden="true" /> shelf matches on-hand ({shelved})</>
            ) : (
              <>
                <TriangleAlert size={12} aria-hidden="true" />
                {shelved} on the shelf vs {onHand} on hand
                <em>{gap > 0 ? `${gap} unaccounted` : `${-gap} more than on hand`}</em>
              </>
            )}
          </span>
        )}
      </header>

      {!bin && (
        <p className="vloc-empty">
          <PackageSearch size={12} aria-hidden="true" />
          Type a shelf code above and save — the picker walks to it, and an unfiled
          variant sits at the bottom of the walk in alphabetical order.
        </p>
      )}

      {/* The gap is information, not an error: a shelf that does not add up is
          telling you something true about the warehouse, and the fix is to
          count it, not to retype a number on this form. */}
      {bin && gap !== 0 && (
        <p className="vloc-note">
          <Link to="/admin/stock" className="vloc-count-link">
            <ClipboardCheck size={12} aria-hidden="true" />
            Count this shelf
          </Link>
          {' '}to settle the difference — a count is recorded with who made it.
        </p>
      )}
    </div>
  );
}
