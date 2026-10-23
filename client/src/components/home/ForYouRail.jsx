import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkle } from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';

/**
 * A shelf built from what this buyer has actually bought.
 *
 * ── Why it existed as half a feature ────────────────────────────────────────
 *
 * `services/ai/taste.js` was finished: it works out what somebody seems to like
 * from their own orders, behind the `recommend` capability and that person's
 * own consent, and forgets it the moment the request ends. It had exactly one
 * consumer — the assistant's retrieval blend — so a buyer who had agreed to
 * recommendations got a marginally better answer when they asked a question and
 * nothing at all anywhere else.
 *
 * This is the other consumer, and it is the one the machinery was obviously
 * for: the taste vector as the whole query, pointed at the shelf.
 *
 * ── Hidden without consent, and hidden without anything to say ──────────────
 *
 * The rail renders nothing at all in six cases — the capability is off, this
 * person has not agreed, they have bought fewer than two things, the shop has
 * no vector store, nothing is embedded yet, or everything near their taste is
 * already in their order history. All six look identical here, deliberately.
 *
 * There is no empty state and no "turn this on" prompt, which is a departure
 * from DESIGN §9's rule that empty states are navigation. The exception is the
 * point: a shelf saying "we could recommend things if you let us read your
 * purchases" is a consent prompt dressed as a product feature, on the page a
 * visitor lands on. Consent for this lives on the profile page beside every
 * other AI switch, where somebody goes to make that decision rather than
 * meeting it between the carousel and the reviews.
 *
 * ── Why the price is the server's ───────────────────────────────────────────
 *
 * The cards come from `storeKnowledge.productCards`, the same builder every
 * assistant answer uses: flash sale, tier discount and sub-user markup already
 * applied for this account. `CLAUDE.md` makes `pricingService` the single
 * source of truth for money, so the rail quotes what checkout will charge
 * rather than re-deriving a list price here.
 */
export default function ForYouRail() {
  const { user } = useAuth();
  const [products, setProducts] = useState(null);

  useEffect(() => {
    if (!user) { setProducts([]); return undefined; }
    let alive = true;
    // One request, on mount, and never retried. A rail is a bonus: a buyer who
    // arrives while the vector store is restarting sees the page they came for,
    // and a retry loop on a home page is a cost paid by every visitor for a
    // feature most of them have not turned on.
    api.get('/ai/for-you')
      .then((res) => { if (alive) setProducts(Array.isArray(res?.products) ? res.products : []); })
      .catch(() => { if (alive) setProducts([]); });
    return () => { alive = false; };
  }, [user]);

  // `null` is "still asking" and `[]` is "nothing to show". Both render
  // nothing: a skeleton for a rail that is usually absent would make the page
  // jump on every load for the majority of visitors.
  if (!products || products.length === 0) return null;

  return (
    <section className="fyr" aria-labelledby="fyr-title">
      <div className="fyr-head">
        <h2 id="fyr-title" className="section-title fyr-title">
          <Sparkle size={16} aria-hidden="true" /> For you
        </h2>
        {/*
          * What it is built from, said plainly and in one line.
          *
          * Not a tooltip and not a link to a policy. This is the one sentence
          * that makes the rail feel like a shop rather than surveillance, and
          * it is true in an unusually strong way: there is no stored profile to
          * describe, because `taste.js` computes the vector per request and
          * drops it. "Worked out from your orders each time" is a fact, not a
          * reassurance.
          */}
        <p className="fyr-why">
          From what you have ordered — worked out fresh each visit and never stored.
          {' '}<Link to="/profile">Change this</Link>
        </p>
      </div>

      {/*
        * §6: a horizontally scrolled rail, not a grid and not a carousel.
        *
        * A grid would compete with the Featured carousel above it — two
        * full-width shelves on one page is a page with no hierarchy. A carousel
        * would need arrows, dots and an index for eight cards nobody has to see
        * all of. A scroll rail with snap points is the honest shape: it is
        * secondary, it is finite, and on a phone it is the gesture people
        * already use.
        */}
      <ul className="fyr-rail">
        {products.map((p) => {
          // The cheapest live option, which is what a shelf card quotes.
          // `productCards` prices every variant for this account; picking the
          // lowest is what the catalogue grid does, so the two agree.
          const options = Array.isArray(p.variants) ? p.variants : [];
          const buyable = options.filter((v) => v.inStock);
          const cheapest = (buyable.length ? buyable : options)
            .reduce((best, v) => (best && Number(best.price) <= Number(v.price) ? best : v), null);
          return (
            <li key={p.id} className="fyr-item">
              <Link to={`/products/${p.id}`} className="fyr-card">
                <span className="fyr-name">{p.name}</span>
                {p.brand && <span className="fyr-brand">{p.brand}</span>}
                <span className="fyr-foot">
                  {cheapest && <span className="fyr-price">${cheapest.price}</span>}
                  {/* Out of stock is stated rather than hidden. The server only
                      offers groups with something buyable, but a variant can
                      sell out between that query and this render, and a card
                      that quotes a price for nothing is worse than one that
                      says so. */}
                  {buyable.length === 0 && <span className="fyr-gone">sold out</span>}
                  {options.length > 1 && (
                    <span className="fyr-options">{options.length} options</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
