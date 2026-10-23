import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * The windowed pager the admin list pages share.
 *
 * `1 … 4 5 6 … 12`, so the control keeps a fixed width however many pages there
 * are rather than growing a row of forty buttons. The shape was worked out on
 * the Reviews page; it is lifted here so the Orders, Users and Disputes queues
 * do not each grow their own copy that drifts — which is exactly what happened
 * to the page header before `PageHeader` existed.
 *
 * Caller owns `page`; this renders and reports.
 */
export function pageWindow(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out = new Set([1, totalPages, page, page - 1, page + 1]);
  const nums = [...out].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const withGaps = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) withGaps.push(`gap-${n}`);
    withGaps.push(n);
  });
  return withGaps;
}

/**
 * @param {object} props
 * @param {number} props.page          1-based current page
 * @param {number} props.totalPages
 * @param {number} [props.total]       total matching rows, for the caption
 * @param {string} [props.noun]        singular noun for the caption ("order")
 * @param {string} props.label         accessible name for the nav ("Order pages")
 * @param {Function} props.onChange    (nextPage) => void
 * @param {import('react').ReactNode} [props.children] extra controls (page size)
 */
export default function Pager({ page, totalPages, total, noun = 'result', label, onChange, children }) {
  if (totalPages <= 1 && !children) return null;

  return (
    <nav className="admin-pager" aria-label={label}>
      <button
        type="button"
        className="glass-btn glass-btn-sm"
        disabled={page <= 1}
        onClick={() => onChange(Math.max(1, page - 1))}
        aria-label="Previous page"
      >
        <ChevronLeft size={14} aria-hidden="true" /> Prev
      </button>

      {pageWindow(page, totalPages).map((entry) => (
        typeof entry === 'number' ? (
          <button
            key={entry}
            type="button"
            className={`glass-btn glass-btn-sm admin-pager-num${entry === page ? ' glass-btn-active' : ''}`}
            onClick={() => onChange(entry)}
            aria-current={entry === page ? 'page' : undefined}
            aria-label={`Page ${entry}`}
          >
            {entry}
          </button>
        ) : (
          <span key={entry} className="admin-pager-gap" aria-hidden="true">…</span>
        )
      ))}

      <button
        type="button"
        className="glass-btn glass-btn-sm"
        disabled={page >= totalPages}
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        aria-label="Next page"
      >
        Next <ChevronRight size={14} aria-hidden="true" />
      </button>

      {children ? <div className="admin-pager-extra">{children}</div> : null}

      {/* The numbered buttons are hidden below 400px — they do not fit — so
          the caption has to carry the current page. Without it a phone user
          could page through a queue with nothing on screen saying where they
          were. */}
      {total != null && (
        <span className="admin-pager-total">
          Page {page} of {totalPages} · {total.toLocaleString()} {noun}{total === 1 ? '' : 's'}
        </span>
      )}
    </nav>
  );
}
