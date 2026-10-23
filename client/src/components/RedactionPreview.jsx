import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import { api } from '../utils/api';

/**
 * What the grant set being edited would see on a customer's order, in a sentence.
 *
 * ── Why a sentence, and why it comes from the server ───────────────────────
 *
 * The permission editor is thirty checkboxes with a description each, and the
 * question an operator actually has while ticking them is "so what will this
 * person see when they open an order?" — which no single checkbox answers,
 * because `orders.view_totals` hides line prices as well as the total, and
 * `orders.pick` is what reveals the packing note. The rule that decides is
 * `server/utils/orderVisibility.js`, and this component does not restate it:
 * it sends the proposed set and prints what the real redaction let through on
 * a placeholder order. A client-side copy of the table would be the copy that
 * drifts, and it would drift toward promising less redaction than the server
 * does.
 *
 * Debounced, because every tick is a request and an operator setting up a
 * role ticks a dozen boxes in a row.
 */
export default function RedactionPreview({ permissions }) {
  const [preview, setPreview] = useState(null);
  const key = (permissions || []).slice().sort().join(',');

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.post('/admin/permissions/preview', { permissions: key ? key.split(',') : [] })
        .then((r) => { if (alive) setPreview(r); })
        .catch(() => { if (alive) setPreview(null); });
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [key]);

  if (!preview) return null;

  const join = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

  return (
    <p className="perm-preview" role="status">
      <Eye size={13} aria-hidden="true" />
      {preview.can_open_orders ? (
        <span>
          On any customer&rsquo;s order this role sees the status, the items and quantities, the boxes and
          what happens next{preview.sees.length ? `, plus ${join(preview.sees)}` : ''}.
          {preview.hidden.length
            ? <> Hidden from it: {join(preview.hidden)}.</>
            : <> Nothing on the order is hidden from it.</>}
          {preview.customer_reference && (
            <> The customer appears as <code>customer {preview.customer_reference}</code>, a name that differs on every order.</>
          )}
        </span>
      ) : (
        <span>This role cannot open orders at all. Grant &ldquo;View orders&rdquo; to see what it would be shown on one.</span>
      )}
    </p>
  );
}
