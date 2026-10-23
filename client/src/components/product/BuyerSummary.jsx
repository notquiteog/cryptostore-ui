import { MessageSquareQuote } from 'lucide-react';

/**
 * "What buyers say": the store's own paragraph about a product's reviews.
 *
 * ── What this is, and what it is careful to say it is ──────────────────────
 *
 * The text arrives from `product_groups.review_summary`, which only a
 * moderator can fill (`reviewController.publishReviewSummary`), usually from
 * an AI digest they read and edited first and sometimes by hand. No model
 * runs when this page loads, and nothing is drawn unless the row carries a
 * summary — the parent passes nothing otherwise, and this renders nothing.
 *
 * The line underneath is the honesty line, and it is not decoration. A
 * paragraph in the store's voice sitting above the reviews could pass for a
 * buyer's, or for something computed from all of them today. "Summarised by
 * the store from 14 reviews · 3 Mar 2026" says who wrote it, what it covers,
 * and how old it is, in one sentence — and the count is the one the text was
 * published against (`review_summary_count`), never the number of reviews on
 * the page now, because a figure the paragraph was not written from is the
 * wrong kind of accurate.
 *
 * The date is absolute rather than "3 months ago": staleness is the thing a
 * buyer is judging here, and an absolute date lets them judge it against the
 * dates on the reviews below. `<time>` carries the machine form.
 */
function formatDate(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function BuyerSummary({ text, at, count }) {
  if (!text) return null;
  const date = formatDate(at);
  const n = Number.isFinite(Number(count)) ? Number(count) : 0;

  return (
    <section className="pd-section pd-buyer-summary" id="buyer-summary" data-reveal aria-labelledby="pd-summary-h">
      <header className="pd-section-head">
        <h2 id="pd-summary-h">
          <MessageSquareQuote size={15} aria-hidden="true" />
          What buyers say
        </h2>
        {/* The summary is a door into the reviews, not a replacement for them:
            the count in the line below is a claim a buyer can go and check. */}
        <a href="#reviews" className="pd-section-more">Read the reviews</a>
      </header>
      <div className="pd-prose">
        <p>{text}</p>
      </div>
      <p className="pd-summary-source">
        Summarised by the store from {n} {n === 1 ? 'review' : 'reviews'}
        {date && (
          <>
            {' · '}
            <time dateTime={at}>{date}</time>
          </>
        )}
      </p>
    </section>
  );
}
