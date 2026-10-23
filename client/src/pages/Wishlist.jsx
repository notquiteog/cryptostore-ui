import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Heart, Trash2, ExternalLink, TrendingDown, ArrowDownRight, EyeOff, BellRing, BellOff,
  PackageCheck, Clock, ShoppingCart, Eye, Columns3, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../utils/api';
import { useWishlist } from '../context/WishlistContext';
import CompanionSpot from '../components/ai/CompanionSpot';
import { askAssistant } from '../utils/askAssistant';
import { getAiStatus } from '../utils/aiStatus';

const cents = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;

/**
 * The buyer's price watches.
 *
 * A wishlist remembers the thing; a watch remembers the price the buyer saw
 * and says so when it goes under. Both figures are the buyer's own — tier,
 * sale and markup applied, resolved by the same service that sends the alert
 * (server/services/priceAlerts) — so a watch that reads "was $20, now $17" is
 * a $17 this account would actually pay. A drop that has already been
 * announced stays lit here until the price climbs back and the watch
 * re-arms; the page is the record, the notification was the nudge.
 *
 * ── Why the rows are handed in rather than fetched here ─────────────────────
 *
 * The tab that holds this panel prints a count, and a count the parent does
 * not have is a count that is wrong until the child has loaded. Both lists are
 * loaded once by the page and passed down; the panels own their own mutations
 * and tell the page what changed.
 */
function PriceWatches({ rows, onStopped }) {
  const stop = async (variantId) => {
    onStopped(variantId);
    try {
      await api.delete(`/moderation/price-watch/${variantId}`);
      toast.success('Stopped watching');
    } catch {
      toast.error('Could not stop the watch');
      onStopped(null);
    }
  };

  if (!rows.length) return null;
  return (
    <section className="pw glass-card" aria-labelledby="pw-title">
      <h2 id="pw-title" className="pw-title">
        <TrendingDown size={16} aria-hidden="true" /> Price watches
        <span className="pw-count">{rows.length}</span>
      </h2>
      <p className="pw-lede">
        Your price, not the list price: tier discount and any sale included. You hear once when it drops
        under the line; the watch re-arms if it goes back up.
      </p>
      <ul className="pw-list">
        {rows.map((r) => (
          <li key={r.variant_id} className={`pw-row${r.dropped ? ' is-dropped' : ''}${!r.available ? ' is-gone' : ''}`}>
            <div className="pw-what">
              {r.group_id
                ? <Link to={`/products/${r.group_id}`} className="pw-name">{r.group_name}</Link>
                : <span className="pw-name">{r.group_name || 'A product that is no longer listed'}</span>}
              {r.variant_name && <span className="pw-variant">{r.variant_name}</span>}
              {!r.in_stock && r.available && <span className="pw-flag">out of stock</span>}
              {r.on_sale && <span className="pw-flag is-sale">on sale</span>}
            </div>
            <div className="pw-prices" aria-label={`Watching at ${cents(r.watched_cents)}, now ${cents(r.now_cents)}`}>
              <span className="pw-was">
                <small>watching at</small>
                {cents(r.watched_cents)}
              </span>
              <span className="pw-now">
                <small>now</small>
                {r.now_cents != null ? cents(r.now_cents) : '—'}
                {r.dropped && <ArrowDownRight size={13} aria-hidden="true" />}
              </span>
            </div>
            <button
              type="button"
              className="glass-btn glass-btn-sm pw-stop"
              onClick={() => stop(r.variant_id)}
              title="Stop watching this price"
            >
              <EyeOff size={13} aria-hidden="true" /> Stop
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The buyer's restock subscriptions, above the price watches.
 *
 * ── Why this panel did not exist ────────────────────────────────────────────
 *
 * `restock_subscriptions` shipped with a button on the product page and
 * nothing else: no list, no way to stop one, and — because the notifier had no
 * live caller anywhere — no message either. A buyer who pressed "notify me" on
 * twelve products had twelve invisible rows and no screen that admitted they
 * existed. The watch is the record; this is where it is kept.
 *
 * ── Ordering, and why availability sits above price ─────────────────────────
 *
 * This panel is drawn before `PriceWatches` because "can I buy it at all"
 * outranks "what does it cost". A row that has crossed carries Add to cart
 * rather than only a link, for the reason DESIGN §9 gives about ending
 * pointing forward: telling somebody a thing is back and then making them
 * navigate and re-find it is most of the work still left to do.
 *
 * ── The list question (DESIGN §6) ───────────────────────────────────────────
 *
 * Neither a responsive table nor two views. Three fields, one of which is a
 * word, and a single collapse to one column at 560px — the same geometry as
 * the price-watch rows it sits above, on purpose, so the two read as one
 * system rather than two features sharing a page.
 */
function RestockWatches({ rows, onStopped, onStale }) {
  const [adding, setAdding] = useState(null);

  const stop = async (variantId) => {
    onStopped(variantId);
    try {
      await api.delete(`/moderation/restock/${variantId}`);
      toast.success('Stopped watching');
    } catch {
      toast.error('Could not stop the watch');
      onStopped(null);
    }
  };

  const addToCart = async (row) => {
    setAdding(row.variant_id);
    try {
      await api.post('/orders/cart', { variant_id: row.variant_id, quantity: 1 });
      toast.success('Added to cart');
    } catch (err) {
      // Most likely it sold out again between the scan and this click, which
      // is exactly the case the row must not pretend away — reload so the
      // state on screen is the state the server just enforced.
      toast.error(err.message || 'Could not add it to the cart');
      onStale();
    } finally {
      setAdding(null);
    }
  };

  if (!rows.length) return null;
  const backCount = rows.filter((r) => r.in_stock && r.available).length;

  return (
    <section className="rw glass-card" aria-labelledby="rw-title">
      <h2 id="rw-title" className="pw-title">
        <BellRing size={16} aria-hidden="true" /> Waiting for stock
        <span className="pw-count">{rows.length}</span>
      </h2>
      <p className="pw-lede">
        {backCount > 0
          ? `${backCount === 1 ? 'One of these is' : `${backCount} of these are`} back — add it before it goes again. `
          : ''}
        You hear once each time something returns, on every channel you have linked. It goes quiet
        while the item is in stock and arms itself again when it sells out.
      </p>
      <ul className="rw-list">
        {rows.map((r) => {
          const back = r.in_stock && r.available;
          return (
            <li
              key={r.variant_id}
              className={`rw-row${back ? ' is-back' : ''}${!r.available ? ' is-gone' : ''}`}
            >
              <div className="pw-what">
                {r.group_id
                  ? <Link to={`/products/${r.group_id}`} className="pw-name">{r.group_name}</Link>
                  : <span className="pw-name">{r.group_name || 'A product that is no longer listed'}</span>}
                {r.variant_name && <span className="pw-variant">{r.variant_name}</span>}
              </div>
              <span className="rw-state">
                {!r.available
                  ? <><BellOff size={12} aria-hidden="true" /> no longer listed</>
                  : back
                    ? <><PackageCheck size={12} aria-hidden="true" /> in stock</>
                    : <><Clock size={12} aria-hidden="true" /> waiting</>}
              </span>
              <div className="rw-actions">
                {back && (
                  <button
                    type="button"
                    className="glass-btn glass-btn-primary glass-btn-sm"
                    onClick={() => addToCart(r)}
                    disabled={adding === r.variant_id}
                  >
                    <ShoppingCart size={13} aria-hidden="true" />
                    {adding === r.variant_id ? 'Adding…' : 'Add to cart'}
                  </button>
                )}
                <button
                  type="button"
                  className="glass-btn glass-btn-sm pw-stop"
                  onClick={() => stop(r.variant_id)}
                  title="Stop watching this product"
                >
                  <BellOff size={13} aria-hidden="true" /> Stop
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Saved things, and things being watched, as two tabs.
 *
 * ── Why a tab and not two panels down one page ──────────────────────────────
 *
 * They were two panels down one page, and they were invisible. Both returned
 * `null` when empty, so a buyer who had never set an alert saw nothing — which
 * is correct for a panel and wrong for a FEATURE, because the page then never
 * says the shop can do this at all. Worse, a buyer who HAD set nine alerts had
 * to scroll a grid of saved products to find out, and the assistant's own
 * `set_restock_alert` tool had nowhere to send them afterwards.
 *
 * A tab is the smallest thing that fixes both. It carries a count, so the
 * answer to "am I watching anything" is visible without a click; it is
 * addressable, so `?tab=watching` is a real destination the `my-alerts` topic
 * and the bots' `/watching` can name; and an empty Watching tab gets a real
 * empty state instead of an absence.
 *
 * ── Why the tab lives in the URL ────────────────────────────────────────────
 *
 * Because three other surfaces link into it: the assistant topic, the bot
 * command's closing line, and a restock notification. A tab held only in
 * component state is a tab nothing can link to, and "open your wishlist and
 * press Watching" is an instruction rather than a link.
 */
const TABS = ['saved', 'watching'];

export default function Wishlist() {
  // This page deletes rows by its own route rather than through the context's
  // toggle, so it has to say so — otherwise the hearts on the catalog and the
  // navbar panel keep showing an item this page just removed.
  const { forget, refresh } = useWishlist();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingAll, setAddingAll] = useState(false);

  // Both watch lists, owned here so the tab can print a count before anybody
  // opens it. `null` means "not loaded yet" and is distinct from `[]`, which
  // means "loaded, and there are none" — the tab badge must not claim zero
  // while the request is still out.
  const [restock, setRestock] = useState(null);
  const [watches, setWatches] = useState(null);

  // Whether this person is offered the assistant at all, for the compare bar.
  // A button that dispatches a question to a feature the operator switched off
  // is a button that does nothing when pressed, so it is not drawn.
  const [assistant, setAssistant] = useState(false);
  const [picked, setPicked] = useState([]);

  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'saved';
  const setTab = (next) => {
    const p = new URLSearchParams(params);
    if (next === 'saved') p.delete('tab'); else p.set('tab', next);
    // `replace` so flicking between the two tabs does not bury the page the
    // buyer arrived from under six history entries.
    setParams(p, { replace: true });
  };

  const loadWatches = useCallback(() => {
    api.get('/moderation/restock').then(setRestock).catch(() => setRestock([]));
    api.get('/moderation/price-watch').then(setWatches).catch(() => setWatches([]));
  }, []);

  useEffect(() => {
    api.get('/wishlist')
      .then(data => setItems(data))
      .catch(() => toast.error('Failed to load wishlist'))
      .finally(() => setLoading(false));
    loadWatches();
    getAiStatus()
      .then((s) => setAssistant(Boolean(s?.enabled && s.capabilities?.find((c) => c.id === 'assistant')?.offered)))
      .catch(() => setAssistant(false));
  }, [loadWatches]);

  const addAllToCart = async () => {
    if (items.length === 0) return;
    setAddingAll(true);
    let added = 0, failed = 0;
    for (const item of items) {
      try {
        await api.post('/orders/cart', { variant_id: item.variant_id, quantity: 1 });
        added++;
      } catch (e) {
        failed++;
      }
    }
    setAddingAll(false);
    if (added > 0) toast.success(`Added ${added} item${added > 1 ? 's' : ''} to cart`);
    if (failed > 0) toast.error(`${failed} item${failed > 1 ? 's' : ''} failed (out of stock?)`);
  };

  const handleRemove = (variantId) => {
    setItems(prev => prev.filter(item => item.variant_id !== variantId));
    setPicked((prev) => prev.filter((id) => id !== variantId));
    forget(variantId);
    api.delete(`/wishlist/${variantId}`)
      .then(() => toast.success('Removed from wishlist'))
      .catch(() => {
        toast.error('Failed to remove item');
        api.get('/wishlist').then(data => setItems(data)).catch(() => {});
        // The row is back on screen, so the shared id set has to come back
        // too — `forget` above was optimistic and is now known to be wrong.
        refresh();
      });
  };

  /*
   * ── Compare, through the assistant that already does it ───────────────────
   *
   * `compare_products` exists in `services/ai/tools.js`: it reads the live
   * price, the stock and the listed specifications for two to four options and
   * returns a table the app renders as a card. It was only reachable by asking
   * for it in words, which means it was reachable by people who already knew it
   * existed.
   *
   * So this dispatches the question rather than calling an endpoint. No new
   * server code, and — more importantly — no SECOND comparison: a `/compare`
   * route would be a separate renderer with its own price lookup, and
   * `CLAUDE.md` is explicit that a second price path is how prices start
   * disagreeing with each other.
   *
   * The names are written exactly as the cards show them, because that is what
   * the tool's own guard requires: it resolves each name against the turn's
   * retrieved candidates and refuses anything it was not already shown. A
   * question naming two products the buyer has saved retrieves those two
   * products, so the guard is satisfied by the question rather than bypassed.
   */
  const pickedNames = useMemo(
    () => picked
      .map((id) => items.find((i) => i.variant_id === id))
      .filter(Boolean)
      .map((i) => (i.variant_name ? `${i.group_name} — ${i.variant_name}` : i.group_name)),
    [picked, items],
  );

  const compare = () => {
    if (pickedNames.length < 2) return;
    askAssistant(`Compare ${pickedNames.join(' and ')}`);
    setPicked([]);
  };

  const togglePick = (variantId) => {
    setPicked((prev) => {
      if (prev.includes(variantId)) return prev.filter((id) => id !== variantId);
      // Four is the tool's own ceiling, and it is enforced here so the fifth
      // tick is refused with an explanation rather than silently dropped by the
      // server after the question has already been asked.
      if (prev.length >= 4) {
        toast.error('Four at a time is the most that fits side by side');
        return prev;
      }
      return [...prev, variantId];
    });
  };

  const watchCount = (restock?.length ?? 0) + (watches?.length ?? 0);
  const watchesKnown = restock !== null && watches !== null;

  return (
    <div className="page container">
      <div className="wl-head">
        <h1 className="page-title wl-title">
          <Heart size={28} style={{ color: 'var(--danger)' }} />
          Wishlist
        </h1>
        {tab === 'saved' && items.length > 0 && (
          <button className="glass-btn glass-btn-primary glass-btn-sm" onClick={addAllToCart} disabled={addingAll}>
            {addingAll ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Add All to Cart'}
          </button>
        )}
      </div>

      {/* Two tabs, each carrying its own count. The count is the information —
          it is what makes "am I watching anything" answerable without a click
          — so it is printed rather than hinted at with a dot. */}
      <div className="wl-tabs" role="tablist" aria-label="Wishlist and watches">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'saved'}
          className="wl-tab"
          onClick={() => setTab('saved')}
        >
          <Heart size={14} aria-hidden="true" /> Saved
          {!loading && <span className="wl-tab-count">{items.length}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'watching'}
          className="wl-tab"
          onClick={() => setTab('watching')}
        >
          <Eye size={14} aria-hidden="true" /> Watching
          {watchesKnown && <span className="wl-tab-count">{watchCount}</span>}
        </button>
      </div>

      {tab === 'watching' ? (
        <div role="tabpanel" aria-label="Watching">
          {!watchesKnown ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
              <span className="spinner" />
            </div>
          ) : watchCount === 0 ? (
            /*
             * The empty state this feature existed without. Navigation, not
             * apology (DESIGN §9): it names both mechanisms, says where the
             * controls are, and links to the catalogue where they are pressed.
             */
            <div className="glass-card empty-state">
              <CompanionSpot fallback={<Eye aria-hidden="true" />} />
              <h3>You are not watching anything</h3>
              <p>
                On any product page the bell sets <strong>tell me when this is back in stock</strong> and the
                eye sets <strong>tell me if this gets cheaper</strong>. Alerts reach you on every channel you
                have linked, once per crossing — never on a loop.
              </p>
              <Link to="/products" className="glass-btn glass-btn-primary">
                Browse products
              </Link>
            </div>
          ) : (
            <>
              <RestockWatches
                rows={restock}
                onStopped={(variantId) => (variantId === null
                  ? loadWatches()
                  : setRestock((prev) => (prev || []).filter((r) => r.variant_id !== variantId)))}
                onStale={loadWatches}
              />
              <PriceWatches
                rows={watches}
                onStopped={(variantId) => (variantId === null
                  ? loadWatches()
                  : setWatches((prev) => (prev || []).filter((r) => r.variant_id !== variantId)))}
              />
            </>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label="Saved">
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
              <span className="spinner" />
            </div>
          ) : items.length === 0 ? (
            <div className="glass-card empty-state">
              <CompanionSpot fallback={<Heart aria-hidden="true" />} />
              <h3>Nothing saved yet</h3>
              <p>Tap the heart on any product to keep it here. Saved items track price and stock, so you will know when something you wanted comes back.</p>
              <Link to="/products" className="glass-btn glass-btn-primary">
                Browse products
              </Link>
            </div>
          ) : (
            <div className="wl-grid">
              {items.map(item => {
                const selected = picked.includes(item.variant_id);
                return (
                  <div
                    key={item.variant_id}
                    className={`glass-card wl-card${selected ? ' is-picked' : ''}`}
                  >
                    {/*
                      * The tick sits on the image rather than in the body,
                      * because the body is where the name and price go and a
                      * control there would push them down. Hover-revealed on a
                      * fine pointer and always present on a coarse one (§4);
                      * once anything is picked it stays visible on every card,
                      * or adding a second item would mean hunting for a control
                      * that appears under the cursor.
                      */}
                    {assistant && (
                      <label className="wl-pick" data-armed={picked.length ? 'yes' : 'no'}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => togglePick(item.variant_id)}
                        />
                        <span className="sr-only">{`Compare ${item.group_name}`}</span>
                      </label>
                    )}
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.group_name} className="wl-shot" />
                    ) : (
                      <div className="wl-shot wl-shot-empty">
                        <Heart size={40} style={{ color: 'var(--border)' }} />
                      </div>
                    )}

                    <div className="wl-body">
                      <p className="wl-name">{item.group_name}</p>
                      {item.variant_name && <p className="wl-variant">{item.variant_name}</p>}
                      <p className="wl-price">${Number(item.price).toFixed(2)}</p>

                      <div className="wl-actions">
                        <Link
                          to={`/products/${item.group_id}`}
                          className="glass-btn glass-btn-primary glass-btn-sm wl-view"
                        >
                          <ExternalLink size={13} />
                          View
                        </Link>
                        <button
                          className="glass-btn glass-btn-sm wl-remove"
                          onClick={() => handleRemove(item.variant_id)}
                          aria-label="Remove from wishlist"
                        >
                          <Trash2 size={13} />
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* The selection toolbar. Appears only once something is ticked, and says
          what pressing it will do — the answer arrives in the assistant panel,
          which is somewhere else on the screen, so the button has to set that
          expectation rather than look like it will act in place. */}
      {tab === 'saved' && picked.length > 0 && (
        <div className="wl-compare-bar" role="region" aria-label="Compare selection">
          <span className="wl-compare-count">
            {picked.length} selected
            {picked.length === 1 && <em> — pick one more to compare</em>}
          </span>
          <button
            type="button"
            className="glass-btn glass-btn-primary glass-btn-sm"
            onClick={compare}
            disabled={picked.length < 2}
          >
            <Columns3 size={13} aria-hidden="true" /> Compare side by side
          </button>
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={() => setPicked([])}
            aria-label="Clear selection"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
