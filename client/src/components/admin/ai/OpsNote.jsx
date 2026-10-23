import { Link } from 'react-router-dom';
import { NotebookPen } from 'lucide-react';
import DraftTool from './DraftTool';
import { useAuth } from '../../../context/AuthContext';
import { canAccessAdminPath } from '../../../utils/adminPermissions';

/**
 * The day's shop in a paragraph, on the page that already asks that question.
 *
 * The dashboard's own comment says it answers "how is the store doing and what
 * needs me". This is the second half of that in prose, and it sits at the top
 * because it costs one chip until somebody asks for it — a summary buried
 * under three screens of charts is a summary of a page nobody scrolled to.
 *
 * ── Why the counts come back with the prose, and are rendered ─────────────
 *
 * `generate.opsSummary` computes every figure in SQL and hands the model
 * facts, so the model turns numbers into a sentence and never decides what is
 * urgent — the same line `riskScan.js` holds. It then returns the facts
 * ALONGSIDE the summary, and the comment there says why: "a summary an
 * operator cannot check against the numbers it came from is a summary they
 * have to trust." Dropping the facts row would throw that away, so the row is
 * not optional decoration.
 *
 * ── Why each fact is a link, and why some of them are not ─────────────────
 *
 * DESIGN §9: if a field names another record, it is a link. "Four orders
 * awaiting payment" names a filtered list that already exists, and a dashboard
 * that states a number without offering the way to it is a dead end.
 *
 * But the dashboard rides `analytics.dashboard` alone, and a manager holding
 * only that grant may not hold `orders.view`. So a fact whose destination this
 * person cannot open renders as plain text rather than a link that bounces
 * them back to their own default page — the same rule the sidebar follows.
 * The number is still shown: knowing four orders are waiting is not the same
 * permission as opening them, and the summary already said it in words.
 */

/**
 * Each fact, in the order an operator acts on them: money owed to the shop
 * first, then work waiting on the shop, then the shelf.
 */
const FACTS = [
  {
    key: 'orders_awaiting_payment',
    label: 'awaiting payment',
    to: '/admin/orders?status=pending_payment',
    path: '/admin/orders',
  },
  {
    key: 'orders_awaiting_confirmation',
    label: 'awaiting confirmation',
    to: '/admin/orders?status=awaiting_confirmation',
    path: '/admin/orders',
  },
  {
    key: 'open_support_tickets',
    label: 'open tickets',
    to: '/admin/support',
    path: '/admin/support',
  },
  {
    key: 'variants_out_of_stock',
    label: 'variants out of stock',
    to: '/admin/stock',
    path: '/admin/stock',
  },
];

export default function OpsNote() {
  const { user } = useAuth();

  return (
    <DraftTool
      capability="ops"
      icon={NotebookPen}
      label="Read the day"
      hint="Counts read from the database, turned into a paragraph."
      slipTitle="Today, in a paragraph"
      busyLabel="Reading…"
      className="aidraft-ops"
      run={() => ({ path: '/ai/ops', method: 'GET' })}
      renderDraft={(res) => (
        <>
          <p className="aidraft-prose">{res.summary}</p>
          <div className="aidraft-facts">
            {FACTS.map((f) => {
              const n = res.facts?.[f.key] ?? 0;
              const body = (
                <>
                  <span className="aidraft-fact-n">{n}</span>
                  <span>{f.label}</span>
                </>
              );
              return canAccessAdminPath(user, f.path)
                ? <Link key={f.key} to={f.to} className="aidraft-fact">{body}</Link>
                : <span key={f.key} className="aidraft-fact">{body}</span>;
            })}
          </div>
        </>
      )}
    />
  );
}
