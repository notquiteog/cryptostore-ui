import SharedStockPool from '../../components/admin/SharedStockPool';
import ProgressBar from '../../components/ProgressBar';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { api } from '../../utils/api';
import toast from 'react-hot-toast';
import {
  AlertTriangle, ArrowLeft, Boxes, CalendarClock, Check, ChevronDown, Coins, Copy, Eye, EyeOff,
  Image as ImageIcon, Info, Layers, Package, Plus, Save, Sparkles, Tag, Trash2, Users, X,
} from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';
import VariantShelf from '../../components/admin/VariantShelf';
import { useTheme } from '../../context/ThemeContext';
// The next variant, proposed from the ones already there. Pure, tested in
// server/test/variantSuggest.test.js, and deliberately incapable of inventing
// a price — see the module's header.
import { suggestVariants } from '../../utils/variantSuggest';
import MediaSlots from '../../components/admin/MediaSlots';
import CopyAssist from '../../components/admin/ai/CopyAssist';
import TagAssist from '../../components/admin/ai/TagAssist';
import BundleRecipe from '../../components/admin/BundleRecipe';
import { useAuth } from '../../context/AuthContext';
import { hasAdminPermission } from '../../utils/adminPermissions';
import { useMediaJobsFeed } from '../../hooks/useMediaJobsFeed';
import { MEDIA_JOBS_PERMISSION, feedKey } from '../../utils/mediaJobsPolling';
import AttributeAssist from '../../components/admin/ai/AttributeAssist';
import { UNIT_STEP, validUnits, packsFrom, formatUnits } from '../../utils/stockUnits';
import { unitPriceNotes, formatPerUnit } from '../../utils/unitPricing';

/**
 * Create and edit one product.
 *
 * The page it replaces had three problems worth naming, because the shape of
 * this one is a response to each:
 *
 *  1. **Creating a product dead-ended.** The form saved, navigated to the edit
 *     URL, and only then revealed the media and variant sections — so "add a
 *     product" was two visually different pages with no indication that the
 *     first was half of the second. Now it is one page throughout, with the
 *     later sections present and explaining why they are waiting.
 *  2. **Variant media was write-only.** Files could be uploaded and then never
 *     seen, reordered or deleted — the response was discarded. Both scopes now
 *     use the same slot manager.
 *  3. **Nothing said what was unsaved.** Product fields and each variant saved
 *     independently with no dirty state, so it was genuinely unclear whether a
 *     typed change had landed. Every section now shows its own state.
 *
 * Media slots are interchangeable image/video throughout — see MediaSlots.
 */

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/**
 * `<input type="datetime-local">` speaks `YYYY-MM-DDTHH:mm` in the operator's
 * OWN timezone and has no way to express an offset; the API speaks UTC
 * instants. These two do the conversion in one place each.
 *
 * Getting this wrong is not a cosmetic bug — an operator in UTC+2 scheduling
 * "Friday 20:00" and having it stored as 20:00Z drops the product two hours
 * early, to everyone, with no way to tell from the form that it happened. The
 * shift through `getTimezoneOffset` is what keeps the field showing the same
 * wall-clock time the operator typed after a reload.
 */
/**
 * What this option last cost, against what it is about to sell for.
 *
 * ── Why here, under the price field ────────────────────────────────────────
 *
 * Because this is the moment the decision is made. A margin report tells an
 * operator last month that a line lost money; a line under the box they are
 * typing into tells them before it does. The cost comes from the most recent
 * priced receipt (`services/stockReceipts.costFor`) and is only present for
 * somebody whose grants allow it — the server omits the field entirely
 * otherwise, so there is nothing to render and nothing to explain.
 *
 * ── It states, and never blocks ────────────────────────────────────────────
 *
 * Below cost is a warning, not an error, and the field stays saveable. Shops
 * sell under cost on purpose — a clearance, a loss leader, making good on a
 * complaint — and a form that refused would be making a commercial decision
 * that belongs to the operator. `pricingService` takes the same line: it
 * reports `belowCost` and clamps nothing.
 *
 * ── The arithmetic is in cents, here as everywhere ─────────────────────────
 *
 * The price is a string from a text input; it becomes cents by the same
 * rounding the engine uses before anything is subtracted. Doing it in floats
 * would put "$0.01 margin" on a line that is exactly break-even, which is the
 * kind of wrongness this codebase spends a whole test file preventing.
 */
function MarginNote({ price, costCents }) {
  if (!Number.isFinite(Number(costCents))) return null;
  const asked = Number(price);
  if (!Number.isFinite(asked) || price === '' || price === null) return null;

  const priceCents = Math.round(Number(asked.toFixed(2)) * 100);
  const marginCents = priceCents - Number(costCents);
  const money = (cents) => `$${(Math.abs(cents) / 100).toFixed(2)}`;
  const below = marginCents < 0;

  return (
    <small className={`apvar-margin${below ? ' is-below' : ''}`}>
      {below
        ? `Below cost — ${money(costCents)} each, losing ${money(marginCents)} a unit`
        : `Cost ${money(costCents)} each · margin ${money(marginCents)}`}
    </small>
  );
}

function toLocalInput(iso) {
  if (!iso) return '';
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return '';
  return new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** …and back. An empty field is "publish immediately", which the API takes as null. */
function fromLocalInput(value) {
  if (!value) return null;
  // A bare `YYYY-MM-DDTHH:mm` is parsed as local time, which is exactly what
  // the operator meant by typing it into a local-time control.
  const at = new Date(value);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
}

const fullDateTime = (d) => d.toLocaleString(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** "1 h 30 m early" — the head start, in the units an operator thinks in. */
function offsetLabel(minutes) {
  if (!minutes) return 'at go-live';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const days = Math.floor(h / 24);
  if (days >= 1) {
    const rh = h % 24;
    return `${days}d${rh ? ` ${rh}h` : ''} early`;
  }
  if (h >= 1) return `${h}h${m ? ` ${m}m` : ''} early`;
  return `${m}m early`;
}

/** Blank variant, in the shape the API expects. */
const blankVariant = () => ({
  name: '', description: '', price: '', quantity: 0, stock_units: 1, tiers: [], images: [], isNew: true,
});

function Section({ icon: Icon, title, subtitle, right, children, tone, role }) {
  return (
    <section className="glass-card apedit-section" style={tone ? { '--apedit-tone': tone } : undefined} role={role}>
      <header className="apedit-head">
        <div className="apedit-head-main">
          <h2 className="apedit-title"><Icon size={16} aria-hidden="true" /> {title}</h2>
          {subtitle && <p className="apedit-sub">{subtitle}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

function VariantCard({
  variant, index, productId, onPatch, onSave, onDelete, saving, breakdown, stockQuantity, unitNote,
  // This variant's entry from the page's one media poll, handed down rather
  // than fetched here — see useMediaJobsFeed for the fan-out it replaces.
  mediaFeed, mediaFeedError, onMediaFeedRefresh,
}) {
  const [open, setOpen] = useState(variant.isNew);
  const v = variant;
  // Whether this shop files stock on shelves at all (utils/warehouseEnabled.js).
  // Read here rather than threaded down as a prop: every other card on this
  // page already reads the store settings for its own reasons, and a prop
  // handed through two components for one boolean is a prop the next variant
  // card forgets to pass. Absent means on, matching the server's getBool.
  const { settings } = useTheme();
  const shelvesTracked = settings.warehouse_enabled !== 'false';

  const patch = (fields) => onPatch(index, fields);

  const setTier = (ti, fields) => {
    const tiers = [...(v.tiers || [])];
    tiers[ti] = { ...tiers[ti], ...fields };
    patch({ tiers });
  };

  // Whole packs, worked out in hundredths — the client half of
  // services/inventory's rule. A pack size may be fractional (an eighth takes
  // 3.5 g), and dividing floats here would show a different number of available
  // packs than the server is willing to sell.
  const available = breakdown ? packsFrom(stockQuantity, v.stock_units) : Number(v.quantity || 0);
  const stockTone = available > 0 ? 'var(--success)' : 'var(--danger)';

  return (
    <article className={`apvar${v.isNew ? ' is-new' : ''}${v.active === false ? ' is-off' : ''}`}>
      <header className="apvar-head">
        <button
          type="button"
          className="apvar-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <ChevronDown size={14} aria-hidden="true" />
          <span className="apvar-name">{v.name || <em>Untitled variant</em>}</span>
        </button>

        <div className="apvar-summary">
          <span className="apvar-price">{v.price === '' ? '—' : money(v.price)}</span>
          <span className="apvar-stock" style={{ '--apvar-stock-tone': stockTone }}>
            <Boxes size={11} aria-hidden="true" /> {available}{breakdown ? ' available' : ''}
          </span>
          {/* The per-unit figure, in the header rather than beside the price
              box, because the cards are COLLAPSED by default: a ladder you can
              only read by opening five cards one at a time is not a ladder, and
              the pair that disagrees is invisible until somebody goes looking.
              Here the column reads 2.68, 2.23, 3.57 at a glance and the odd one
              out is toned as a warning.

              The sentence explaining it is in the body, which is `inert` while
              the card is shut — so the warning state carries its own words in
              `.sr-only` rather than leaving a screen reader with a number and
              no reason it is coloured. */}
          {breakdown && unitNote && (
            <span className={`apvar-unit${unitNote.undercuts ? ' is-under' : ''}`}>
              {unitNote.undercuts && <AlertTriangle size={10} aria-hidden="true" />}
              {formatPerUnit(unitNote.perUnit)}/unit
              {unitNote.undercuts && (
                <span className="sr-only">
                  {' '}— cheaper per unit than {unitNote.undercuts.name || 'the next size up'}
                  {' '}at {formatPerUnit(unitNote.undercuts.perUnit)}
                </span>
              )}
            </span>
          )}
          {(v.tiers || []).length > 0 && (
            <span className="apvar-tag"><Layers size={10} aria-hidden="true" /> {v.tiers.length} tiers</span>
          )}
          {!v.isNew && (v.images || []).length > 0 && (
            <span className="apvar-tag"><ImageIcon size={10} aria-hidden="true" /> {v.images.length}</span>
          )}
          {v.isNew && <span className="apvar-tag is-new">Unsaved</span>}
          {v.active === false && <span className="apvar-tag is-off"><EyeOff size={10} aria-hidden="true" /> Hidden</span>}
        </div>
      </header>

      <div className={`apvar-body${open ? ' is-open' : ''}`}>
        <div className="apvar-body-clip">
          <div className="apvar-body-inner" inert={open ? undefined : true}>
            <div className="apvar-grid">
              <div className="form-group">
                <label htmlFor={`v-name-${index}`}>Variant name</label>
                <input
                  id={`v-name-${index}`}
                  className="glass-input"
                  value={v.name || ''}
                  placeholder="e.g. 3.5g"
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor={`v-price-${index}`}>Price</label>
                <div className="apvar-money">
                  <span className="apvar-money-sign">$</span>
                  <input
                    id={`v-price-${index}`}
                    className="glass-input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={v.price ?? ''}
                    placeholder="0.00"
                    onChange={(e) => patch({ price: e.target.value })}
                  />
                </div>
                <MarginNote price={v.price} costCents={v.unit_cost_cents} />
              </div>
              <div className="form-group">
                <label htmlFor={`v-qty-${index}`}>{breakdown ? 'Amount from stock' : 'In stock'}</label>
                {/* Packs are whole; the amount of stock a pack takes is not.
                    A variant named "3.5g" takes three and a half grams out of
                    the jar, and a step of 1 here was half of why saving one was
                    impossible — the other half was the server's validator.
                    Hundredths, the same two places the column holds and the
                    same step as the total above it. The third place this box
                    used to take was only ever room for a typo: 3.5, 3.05 and
                    3.005 look alike, and the last one sells 3.005 g for
                    ever. */}
                <input
                  id={`v-qty-${index}`}
                  className="glass-input"
                  type="number"
                  min={breakdown ? UNIT_STEP : 0}
                  step={breakdown ? UNIT_STEP : 1}
                  max="2147483647"
                  value={breakdown ? (v.stock_units ?? 1) : (v.quantity ?? 0)}
                  onChange={(e) => patch({ [breakdown ? 'stock_units' : 'quantity']: e.target.value })}
                />
                {breakdown && <p className="apedit-sub">Each purchase uses {formatUnits(v.stock_units ?? 1)} base units, to two decimal places. {available} of this variant can be made from the shared stock.</p>}
              </div>
              {/* Where it physically lives. This is what the pull list walks
                  in, and it is upper-cased on the server so "a1" and "A1" are
                  one shelf rather than two stops. Filing the whole catalogue
                  is faster from Fulfilment → Shelves; this field is for the
                  one variant already open in front of you.

                  It is the ONLY location control, on a new variant and a saved
                  one alike. A variant lives on one shelf: the multi-row editor
                  that used to sit under this field described a warehouse the
                  pull list, the pack bench and the slot grid would not honour,
                  because every one of them reads this single column. What is
                  under the field now is a readout of what that shelf says. */}
              {shelvesTracked && (
                <div className="form-group">
                  <label htmlFor={`v-bin-${index}`}>
                    Shelf <span className="field-opt">(optional)</span>
                  </label>
                  <input
                    id={`v-bin-${index}`}
                    className="glass-input"
                    type="text"
                    maxLength={32}
                    placeholder="A1"
                    value={v.bin_location || ''}
                    onChange={(e) => patch({ bin_location: e.target.value })}
                  />
                </div>
              )}
            </div>

            {/* The pair that disagrees, named, under the boxes both numbers
                were typed into. Full width rather than inside the price
                column, which is a third of a three-column grid and would wrap
                this to five lines.

                A statement, not a validation error — the field stays saveable
                and the card still saves. A shop prices a small pack keenly on
                purpose sometimes (a sampler, a promotion, a size it is
                clearing), and a form that refused would be making a commercial
                decision that belongs to the operator. Same line `MarginNote`
                takes about selling below cost. */}
            {breakdown && unitNote?.undercuts && (
              <p className="apvar-warn">
                <AlertTriangle size={12} aria-hidden="true" />
                <span>
                  {formatPerUnit(unitNote.perUnit)} per base unit, under{' '}
                  <strong>{unitNote.undercuts.name || 'the next size up'}</strong> at{' '}
                  {formatPerUnit(unitNote.undercuts.perUnit)} — the bigger pack is the worse
                  deal, so bulk buyers will take these instead.
                </span>
              </p>
            )}

            {/* What the shelf records for this variant, and whether it agrees
                with the on-hand figure. Read-only: settling a difference is
                counting, and counting belongs on the screen that audits it.
                Only for a saved variant — a location keys off a variant id
                that does not exist yet. */}
            {shelvesTracked && v.id && !breakdown && <VariantShelf variantId={v.id} />}
            {v.id && breakdown && <SharedStockPool variantId={v.id} />}

            <div className="form-group">
              <label htmlFor={`v-desc-${index}`}>Description <span className="field-opt">(optional)</span></label>
              <textarea
                id={`v-desc-${index}`}
                className="glass-input"
                rows={2}
                value={v.description || ''}
                placeholder="What makes this variant different"
                onChange={(e) => patch({ description: e.target.value })}
              />
              {/* Variant-scoped, which is the whole point: the words buyers
                  used about THIS flavour, with the count that supports each.
                  Accepted words are written to this variant's own tags and
                  never up to the product's — see AttributeAssist for why that
                  distinction is the difference between a true statement and a
                  false one. */}
              {v.id && (
                <AttributeAssist
                  variantId={v.id}
                  existingTags={v.tags || []}
                  onSaved={(tags) => patch({ tags })}
                />
              )}
            </div>

            {/* ── Volume tiers ── */}
            <div className="apvar-tiers">
              <div className="apvar-tiers-head">
                <span className="apvar-label"><Coins size={12} aria-hidden="true" /> Volume tiers</span>
                <span className="apvar-hint">
                  The unit price once the buyer takes enough — lower or higher. The highest
                  qualifying quantity wins, and this product's same-priced variants pool
                  their quantities toward it.
                </span>
              </div>

              {(v.tiers || []).map((tier, ti) => (
                <div key={ti} className="apvar-tier">
                  <input
                    className="glass-input"
                    placeholder="Qty label — 3+"
                    value={tier.min_qty_label || tier.qty || ''}
                    onChange={(e) => setTier(ti, { min_qty_label: e.target.value })}
                    aria-label={`Tier ${ti + 1} quantity label`}
                  />
                  <div className="apvar-money">
                    <span className="apvar-money-sign">$</span>
                    <input
                      className="glass-input"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={tier.price ?? ''}
                      onChange={(e) => setTier(ti, { price: e.target.value })}
                      aria-label={`Tier ${ti + 1} price`}
                    />
                  </div>
                  <button
                    type="button"
                    className="glass-btn glass-btn-danger glass-btn-sm"
                    onClick={() => patch({ tiers: (v.tiers || []).filter((_, i) => i !== ti) })}
                    aria-label={`Remove tier ${ti + 1}`}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              ))}

              {/* This used to read "will never be chosen", which was true only
                  while the engine clamped every tier to the base price. It no
                  longer does, so the same rows are now live money — worth
                  pointing at, but as a check rather than a dead-row notice. */}
              {(v.tiers || []).some((t) => t.price !== '' && Number(t.price) > Number(v.price || 0)) && (
                <p className="apvar-warn">
                  <AlertTriangle size={12} aria-hidden="true" />
                  A tier above the ${Number(v.price || 0).toFixed(2)} base price charges buyers
                  more per unit once they reach that quantity. Allowed — check it is intended.
                </p>
              )}

              <button
                type="button"
                className="glass-btn glass-btn-sm"
                onClick={() => patch({ tiers: [...(v.tiers || []), { min_qty_label: '', price: '' }] })}
              >
                <Plus size={13} aria-hidden="true" /> Add tier
              </button>
            </div>

            {/* ── Variant media ── */}
            {v.isNew ? (
              <p className="apvar-locked">
                <Info size={12} aria-hidden="true" />
                Save this variant before adding media to it.
              </p>
            ) : (
              <div className="apvar-media">
                <span className="apvar-label"><ImageIcon size={12} aria-hidden="true" /> Variant media</span>
                <span className="apvar-hint">
                  Shown when this variant is selected, in place of the product's own media.
                </span>
                <MediaSlots
                  scope="variant"
                  ownerId={v.id}
                  items={v.images || []}
                  onChange={(images) => patch({ images })}
                  hint="Slots hold an image or a video, interchangeably."
                  feed={mediaFeed}
                  feedError={mediaFeedError}
                  onFeedRefresh={onMediaFeedRefresh}
                />
              </div>
            )}

            <div className="apvar-actions">
              <button
                type="button"
                className="glass-btn glass-btn-primary glass-btn-sm"
                onClick={() => onSave(v, index)}
                disabled={saving}
              >
                {saving ? <span className="spinner spinner-inline" /> : <Save size={13} aria-hidden="true" />}
                {v.isNew ? 'Create variant' : 'Save variant'}
              </button>
              {!v.isNew && (
                <label className="apvar-visible">
                  <input
                    type="checkbox"
                    checked={v.active !== false}
                    onChange={(e) => patch({ active: e.target.checked })}
                  />
                  <span>{v.active !== false ? 'Visible' : 'Hidden'}</span>
                </label>
              )}
              <button
                type="button"
                className="glass-btn glass-btn-danger glass-btn-sm apvar-delete"
                onClick={() => onDelete(v, index)}
              >
                <Trash2 size={13} aria-hidden="true" /> Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function ProductEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;
  /* Where this product came from, when it was made by pressing Duplicate.
   *
   * Carried in history state rather than a query string or a fetch: the
   * server does not record "this is a copy of that" on the row (an audit line
   * is the record), so the only moment the page can know is the navigation
   * that brought it here. It survives a reload of THIS entry and is gone the
   * moment the operator leaves, which is exactly the life a "you just made
   * this" notice should have. */
  const location = useLocation();
  const copiedFrom = !isNew && location.state?.duplicatedFrom ? location.state.duplicatedFrom : null;

  const [form, setForm] = useState({
    name: '', description: '', brand: '', category: '', tags: '', active: true,
    publish_at: '', breakdown_enabled: false, stock_quantity: 0, is_bundle: false,
  });
  const [saved, setSaved] = useState(null);
  const [variants, setVariants] = useState([]);
  /* Whether this store sells bundles at all.
   *
   * Probed through the bundle endpoint rather than by reading settings,
   * because that endpoint is already the authority — it refuses with
   * `bundles_disabled` when the feature is off, and a second read of
   * `bundles_enabled` here would be a second place for the answer to come
   * from. Null until it answers, so the switch never appears and then
   * vanishes. A product that has not been saved yet has no id to ask about,
   * which is fine: the recipe needs a saved product anyway. */
  const [bundlesOn, setBundlesOn] = useState(null);
  /* What this editor may offer, and the categories it may offer from.
   *
   * One read, on mount, for BOTH new and existing products — a new product is
   * a form with a category box and no id, so anything hung off
   * `/products/:id?editing=1` would be a helper you only met after saving.
   *
   * The flags are asked for rather than inferred. The tidying rule itself lives
   * on the server, where the CSV importer and the ingest API get it too; this
   * page only needs to know whether to draw the affordances. `null` until it
   * answers, so nothing appears and then vanishes.
   */
  const [hints, setHints] = useState(null);
  const { user } = useAuth();
  // Building moves stock, so it is `products.receive` — the grant for booking
  // goods in — and not the one that let this page be opened.
  const canBuild = hasAdminPermission(user, 'products.receive');
  // Duplicating is creating — the route sits behind `products.create` — so the
  // button is drawn for the same people who may use the New product form, and
  // not for a `products.edit`-only manager who would only meet a 403.
  const canCreate = hasAdminPermission(user, 'products.create');
  // One media-progress poll for the whole page. Each slot below is handed its
  // own entry (`slotFeed`), and a slot that is handed one never polls for
  // itself — one request per page where there used to be one per variant.
  // Off for a product that does not exist yet, and for a viewer without the
  // media grant, whose slots render read-only.
  const canManageMedia = hasAdminPermission(user, MEDIA_JOBS_PERMISSION);
  const mediaFeed = useMediaJobsFeed({ groupId: isNew ? null : Number(id), canManage: canManageMedia });
  const slotFeeds = useMemo(() => {
    const map = new Map();
    if (!mediaFeed.feed) return map;
    for (const [key, entry] of Object.entries(mediaFeed.feed.owners || {})) {
      map.set(key, { ...entry, startedAt: mediaFeed.feed.startedAt });
    }
    return map;
  }, [mediaFeed.feed]);
  // `null` until the page has heard, and for an owner the last answer did not
  // know (a variant saved since) — the slot shows nothing rather than "empty".
  const slotFeed = (scope, ownerId) => slotFeeds.get(feedKey(scope, ownerId)) ?? null;
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [savingVariant, setSavingVariant] = useState(null);
  // The membership ladder, for the per-tier go-live table. `null` means the
  // request has not resolved; `[]` means it did and there are no tiers.
  const [tiers, setTiers] = useState(null);
  const [tiersDenied, setTiersDenied] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  useEffect(() => {
    if (isNew) return;
    // Back to the loading screen whenever the id changes, not only on mount.
    // Duplicate navigates from `/admin/products/5/edit` to `/admin/products/9/
    // edit` with this component still mounted, and without this line the copy's
    // page opened showing the ORIGINAL's name, variants and media for as long as
    // the fetch took — a wrong product on screen, briefly, under the notice
    // saying it is a copy.
    setLoading(true);
    // `editing=1` is what asks for the hidden product and the hidden variants.
    // The permission still decides whether the server grants it; this flag only
    // says which of the endpoint's two jobs is being asked for. Without it the
    // storefront was showing staff a retired size as a buyable one — see
    // getProduct in server/controllers/productController.js.
    api.get(`/products/${id}?editing=1`)
      .then((data) => {
        const next = {
          name: data.name || '',
          description: data.description || '',
          brand: data.brand || '',
          category: data.category || '',
          tags: (data.tags || []).join(', '),
          active: data.active !== false,
          publish_at: toLocalInput(data.publish_at),
          breakdown_enabled: data.breakdown_enabled === true,
          is_bundle: data.is_bundle === true,
          // NUMERIC arrives as '10000.000'; the number input would show the
          // trailing zeros and the dirty-check would call it changed on load.
          stock_quantity: formatUnits(data.stock_quantity ?? 0),
        };
        setForm(next);
        setSaved(next);
        setVariants((data.variants || []).map(v => ({
          ...v,
          quantity: v.independent_quantity ?? v.quantity,
          // Same reason as `stock_quantity` above: NUMERIC(14,2) arrives as
          // '3.50', and a number input showing trailing zeros on every whole
          // pack size is noise the operator did not type.
          stock_units: formatUnits(v.stock_units ?? 1),
          // What the shop holds for it now, kept beside the box so saving can
          // tell a retyped amount from an untouched one — see saveVariant.
          stock_units_saved: formatUnits(v.stock_units ?? 1),
        })));
        setImages(data.images || []);
      })
      .catch(() => toast.error('Product not found'))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  // Reading the tier table needs `users.tiers` or `users.view`, and the
  // catalog-editor preset holds neither — so a 403 here is an ordinary
  // outcome, not a fault. The schedule control keeps working without it; only
  // the per-tier breakdown is replaced by a line saying why it is missing.
  useEffect(() => {
    api.get('/tiers')
      .then((data) => setTiers(Array.isArray(data?.tiers) ? data.tiers : []))
      .catch(() => { setTiers([]); setTiersDenied(true); });
  }, []);

  // ── Scheduled drop, as the operator will actually see it ──
  //
  // Every tier's effective go-live is `publish_at - early_access_minutes`,
  // computed here for display only. The server recomputes it from the same two
  // columns on every read; this is a preview of that decision, never an input
  // to it.
  const schedule = useMemo(() => {
    const iso = fromLocalInput(form.publish_at);
    if (!iso) return null;
    const at = new Date(iso);
    const rows = (tiers || [])
      .map((t) => {
        const minutes = Math.max(0, Number(t.early_access_minutes) || 0);
        return { ...t, minutes, opensAt: new Date(at.getTime() - minutes * 60000) };
      })
      .sort((a, b) => a.opensAt - b.opensAt || a.name.localeCompare(b.name));
    return {
      at,
      rows,
      // Already past means the product is simply live — a schedule that has
      // fired is not a schedule any more, and saying "Scheduled" about it
      // would have the operator hunting for why nobody can see the product.
      pending: at.getTime() > Date.now(),
      anyEarly: rows.some((r) => r.minutes > 0),
    };
  }, [form.publish_at, tiers]);

  // Which fields differ from what is stored. Drives the save button's state, so
  // "did that take?" is answerable by looking rather than by saving again.
  const dirty = useMemo(() => {
    if (isNew) return true;
    if (!saved) return false;
    return Object.keys(form).some((k) => form[k] !== saved[k]);
  }, [form, saved, isNew]);

  const tagList = useMemo(
    () => form.tags.split(',').map((t) => t.trim()).filter(Boolean),
    [form.tags],
  );

  useEffect(() => {
    if (!id) return;
    let alive = true;
    api.get(`/products/${id}/bundle`)
      .then(() => { if (alive) setBundlesOn(true); })
      .catch(() => { if (alive) setBundlesOn(false); });
    return () => { alive = false; };
  }, [id]);

  // Its own one-shot effect, not folded into the bundle probe above: that one
  // is keyed on `id` and returns early without one, and these hints are exactly
  // what a product with no id yet needs. A failure leaves `null`, which draws
  // the page as it was before any of this existed.
  useEffect(() => {
    let alive = true;
    api.get('/products/editor-hints')
      .then((h) => { if (alive) setHints(h); })
      .catch(() => { if (alive) setHints(null); });
    return () => { alive = false; };
  }, []);

  // ── Tags the rest of the category already carries ──
  //
  // The tag field is free text, and free text drifts: one category ended up
  // with "gluten free", "gluten-free" and "GF" as three tags for one idea,
  // which the storefront filter then treated as three shelves. Showing what
  // the category's other products use, ranked by how many carry each, makes
  // reusing the existing word the easy path. Typing a new one still works.
  //
  // Keyed on the trimmed category so a trailing space does not refetch, and
  // debounced so a category typed letter by letter asks once, not nine times.
  // `suggested.category` is kept alongside the list so a stale response for
  // an earlier category is never shown under a newer one.
  const [suggested, setSuggested] = useState({ category: '', tags: [] });
  const category = form.category.trim();
  useEffect(() => {
    if (!category) { setSuggested({ category: '', tags: [] }); return undefined; }
    let cancelled = false;
    const timer = setTimeout(() => {
      const q = new URLSearchParams({ category });
      if (!isNew) q.set('exclude', id);
      api.get(`/products/tags/suggest?${q}`)
        .then((rows) => { if (!cancelled) setSuggested({ category, tags: Array.isArray(rows) ? rows : [] }); })
        // A failed suggestion is not worth a toast: the field still works, the
        // operator just does not get the hints. Show nothing rather than a
        // stale list from the previous category.
        .catch(() => { if (!cancelled) setSuggested({ category, tags: [] }); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [category, id, isNew]);

  // Chips for tags the product does not already have. Case-insensitive so a
  // product tagged "Organic" is not offered "organic" as something new.
  const suggestions = useMemo(() => {
    if (suggested.category !== category) return [];
    const have = new Set(tagList.map((t) => t.toLowerCase()));
    return suggested.tags.filter((s) => !have.has(String(s.tag).toLowerCase()));
  }, [suggested, category, tagList]);

  /* What to offer as the next variant.
   *
   * Recomputed from the variants on screen rather than fetched, because the
   * answer depends on rows that may not be saved yet in the operator's head —
   * they add a pound, see "Half Pound" offered, press it, and the list moves on
   * to the quarter without a round trip.
   *
   * Hidden entirely while a new row is already open: two ways to add a variant
   * on screen at once is a form asking which one you meant. */
  /* Per-unit prices across the ladder, and which pack undercuts the one above
   * it. Only in breakdown mode: without a shared pool the variants are separate
   * products in a row — a hoodie and a sticker — and comparing their prices per
   * unit compares nothing.
   *
   * Recomputed from the rows on screen rather than fetched, so an inversion
   * shows up as the price is typed rather than after a save. `utils/unitPricing`
   * holds the rule and the reasoning; this is only where it is called. */
  const unitNotes = useMemo(
    () => (form.breakdown_enabled ? unitPriceNotes(variants) : []),
    [form.breakdown_enabled, variants],
  );

  const variantIdeas = useMemo(() => {
    if (!hints?.variant_suggestions || isNew) return [];
    if (variants.some((v) => v.isNew)) return [];
    return suggestVariants({ variants, breakdown: form.breakdown_enabled });
  }, [hints, isNew, variants, form.breakdown_enabled]);

  const addTag = (tag) => setForm((f) => {
    const current = f.tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (current.some((t) => t.toLowerCase() === tag.toLowerCase())) return f;
    return { ...f, tags: [...current, tag].join(', ') };
  });

  /**
   * Say so when the shop stored a different spelling than the one typed.
   *
   * The rule itself is the server's — this page never re-implements it, which
   * is the whole reason it compares the answer instead of predicting it. Quiet
   * when nothing changed, and quiet when only the surrounding whitespace did:
   * "saved as Flower" after typing "Flower " is a notification about a space.
   */
  const noteTidiedCategory = (typed, stored) => {
    const before = String(typed ?? '').trim();
    const after = String(stored ?? '').trim();
    if (!before || !after || before === after) return;
    toast(`Category saved as “${after}”`, { icon: '✎' });
  };

  const saveProduct = async () => {
    if (!form.name.trim()) return toast.error('The product needs a name');
    // Two places, the same two the column holds — there is no longer a looser
    // rule to fall back to. This used to hold only a total the operator had
    // TOUCHED to two places and let an untouched one through at the column's
    // three, which was the compromise that let a third decimal survive in a
    // system that had otherwise agreed on two; the migration that narrowed the
    // column rounded those values once, so there is nothing left to be lenient
    // about. Sending the total only when it changed is a separate rule and it
    // stays — see below — because it is about a concurrent edit, not decimals.
    const totalStock = validUnits(form.stock_quantity, { min: 0 });
    if (totalStock === null) {
      return toast.error('Total stock must be a number, zero or more, with at most two decimal places');
    }
    setSaving(true);
    try {
      if (isNew) {
        const product = await api.post('/products', {
          name: form.name,
          description: form.description,
          brand: form.brand,
          category: form.category,
          tags: tagList,
          publish_at: fromLocalInput(form.publish_at),
          // A group needs at least one variant to be purchasable. Seeding a
          // placeholder named after the product is what the old page did, and
          // is still right — it lands the operator on the edit page with
          // something to rename rather than an empty shell.
          breakdown_enabled: form.breakdown_enabled,
          stock_quantity: totalStock,
          // Keep the placeholder hidden until its pack amount and price are ready.
          variants: [{ name: form.name, price: 0, quantity: 0, active: !form.breakdown_enabled }],
        });
        toast.success('Product created — now add its media and variants');
        // The category can come back tidied — folded onto one that already
        // exists, or capitalised. Said out loud, because a field that silently
        // stores something other than what was typed is the thing an operator
        // finds out about from the filter dropdown a week later.
        noteTidiedCategory(form.category, product.category);
        navigate(`/admin/products/${product.id}/edit`, { replace: true });
      } else {
        const updated = await api.put(`/products/${id}`, {
          name: form.name,
          description: form.description,
          brand: form.brand,
          category: form.category,
          active: form.active,
          breakdown_enabled: form.breakdown_enabled,
          is_bundle: form.is_bundle,
          // An unrelated edit must not put stock sold since page load back on sale.
          ...(Number(form.stock_quantity) !== Number(saved?.stock_quantity)
            ? { stock_quantity: totalStock } : {}),
          tags: tagList,
          // Always sent, never omitted: the API treats an absent field as
          // "leave the schedule alone" and an explicit null as "clear it", and
          // clearing is exactly what an emptied field means here.
          publish_at: fromLocalInput(form.publish_at),
        });
        // `updated.category` is what was actually stored, which is not always
        // what was typed — see `utils/categoryName.js`. Put back into the form
        // so the box shows the stored name rather than the draft it replaced.
        const next = { ...form, stock_quantity: updated.stock_quantity, category: updated.category || '' };
        setForm(next);
        setSaved(next);
        toast.success('Product saved');
        noteTidiedCategory(form.category, updated.category);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Make a hidden copy of this product and go and edit it.
   *
   * The copy is made from what is STORED — the server reads the rows, not this
   * form — so unsaved edits are refused rather than silently left behind: an
   * operator who retyped a description, pressed Duplicate and found the old
   * text on the copy would reasonably conclude the button was broken.
   *
   * What comes back is a draft: `active = false`, no stock, no shelf, no
   * media. The notice on the copy's page says so, and the toast says where to
   * go next, because a copy that is not yet a product should not be mistaken
   * for one that is.
   */
  const duplicateProduct = async () => {
    if (dirty) {
      return toast.error('Save or discard your changes first — the copy is made from what is stored');
    }
    setDuplicating(true);
    try {
      const copy = await api.post(`/products/${id}/duplicate`);
      toast.success('Copied — it stays hidden until you switch it Live');
      navigate(`/admin/products/${copy.id}/edit`, {
        state: { duplicatedFrom: { id: Number(id), name: form.name } },
      });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDuplicating(false);
    }
  };

  const patchVariant = (index, fields) => {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, ...fields } : v)));
  };

  const saveVariant = async (variant, index) => {
    if (!variant.name?.trim()) return toast.error('The variant needs a name');
    if (form.breakdown_enabled !== saved?.breakdown_enabled) return toast.error('Save the product’s breakdown setting before saving variants');
    // Fractional on purpose, to two places — the same two the column holds.
    // `unitsTouched` no longer decides how strict the check is (it cannot: one
    // rule); it decides only whether the amount is SENT, which is the separate
    // concurrency rule the total above keeps too.
    const unitsTouched = variant.isNew
      || variant.stock_units_saved === undefined
      || Number(variant.stock_units) !== Number(variant.stock_units_saved);
    const units = validUnits(variant.stock_units ?? 1, { min: 0, allowZero: false });
    if (units === null) {
      return toast.error('Amount from stock must be more than zero, with at most two decimal places');
    }
    // Whole packs only. The server refuses a fraction here rather than
    // truncating it, and saying so before the round trip is kinder than a 400.
    if (!form.breakdown_enabled) {
      const qty = Number(variant.quantity);
      if (!Number.isInteger(qty) || qty < 0) return toast.error('In stock must be a whole number, zero or more');
    }
    setSavingVariant(index);
    try {
      const payload = {
        name: variant.name,
        description: variant.description,
        price: variant.price === '' ? 0 : variant.price,
        ...(form.breakdown_enabled ? {} : { quantity: variant.quantity }),
        ...(unitsTouched ? { stock_units: units } : {}),
        bin_location: variant.bin_location ?? '',
        tiers: variant.tiers,
      };
      if (variant.isNew) {
        const created = await api.post(`/products/${id}/variants`, payload);
        // Keep the tiers we sent: the create response does not echo them, and
        // dropping them here made a freshly created variant look as though its
        // tiers had failed to save.
        patchVariant(index, {
          ...created,
          stock_units: formatUnits(created.stock_units ?? units),
          stock_units_saved: formatUnits(created.stock_units ?? units),
          tiers: variant.tiers || [],
          images: [],
          isNew: false,
        });
        toast.success('Variant created');
      } else {
        await api.put(`/products/variants/${variant.id}`, { ...payload, active: variant.active });
        if (unitsTouched) patchVariant(index, { stock_units: formatUnits(units), stock_units_saved: formatUnits(units) });
        toast.success('Variant saved');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingVariant(null);
    }
  };

  const deleteVariant = async (variant, index) => {
    if (variant.isNew) {
      setVariants((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    if (!confirm(`Delete "${variant.name}"? Its media, tags and tier prices go with it.`)) return;
    try {
      await api.delete(`/products/variants/${variant.id}`);
      setVariants((prev) => prev.filter((_, i) => i !== index));
      toast.success('Variant deleted');
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return <div className="loading-page"><ProgressBar label="Loading product…" /></div>;
  }

  const liveVariants = variants.filter((v) => !v.isNew).length;
  const shelfTotal = form.breakdown_enabled ? formatUnits(form.stock_quantity || 0) : variants.reduce((n, v) => n + (Number(v.quantity) || 0), 0);

  return (
    <div className="admin-page apedit">
      <PageHeader
        icon={Package}
        title={isNew ? 'New product' : form.name || 'Edit product'}
        subtitle={isNew
          ? 'Name it and save — media, variants and pricing come next, on this same page.'
          : `${liveVariants} variant${liveVariants === 1 ? '' : 's'} · ${shelfTotal} ${form.breakdown_enabled ? 'base units in stock' : 'in stock'} · ${images.length} media slot${images.length === 1 ? '' : 's'}`}
      >
        <Link to="/admin/products" className="glass-btn">
          <ArrowLeft size={15} aria-hidden="true" /> All products
        </Link>
        {!isNew && (
          <Link to={`/products/${id}`} className="glass-btn" target="_blank" rel="noreferrer">
            <Eye size={15} aria-hidden="true" /> View in store
          </Link>
        )}
        {/* Not on the New product form: there is nothing stored to copy yet. */}
        {!isNew && canCreate && (
          <button
            type="button"
            className="glass-btn"
            onClick={duplicateProduct}
            disabled={duplicating || saving}
            title="Make a hidden copy of this product with its variants, pricing and tags"
          >
            {duplicating ? <span className="spinner spinner-inline" /> : <Copy size={15} aria-hidden="true" />}
            Duplicate
          </button>
        )}
        <button
          type="button"
          className="glass-btn glass-btn-primary"
          onClick={saveProduct}
          disabled={saving || (!isNew && !dirty)}
        >
          {saving ? <span className="spinner spinner-inline" /> : <Save size={15} aria-hidden="true" />}
          {isNew ? 'Create product' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </PageHeader>

      {/* ── Just duplicated ────────────────────────────────────────────────
          Drawn in the page's own section vocabulary rather than a toast: a
          toast is gone in four seconds and this is the state of the product
          for as long as it stays a draft. Warning-toned because the thing an
          operator most needs to know about a copy is what it does NOT have,
          and the outbound link is the original — the neighbour this record
          has (DESIGN §9). */}
      {copiedFrom && (
        <Section
          icon={Copy}
          tone="var(--warning)"
          role="status"
          title={`A copy of “${copiedFrom.name || 'the original'}”`}
          subtitle="Hidden from the shop and the bots until you switch it Live. The text, tags, variants and pricing came across; stock, shelf and media did not — upload its pictures and book its stock in, then rename it."
          right={(
            <Link to={`/admin/products/${copiedFrom.id}/edit`} className="glass-btn glass-btn-sm">
              <ArrowLeft size={13} aria-hidden="true" /> Open the original
            </Link>
          )}
        />
      )}

      {/* ── Details ─────────────────────────────────────────────────────── */}
      <Section
        icon={Info}
        title="Details"
        subtitle="What the product is called and where it sits in the catalogue."
        right={!isNew && (
          <label className={`apedit-live${form.active ? ' is-on' : ''}`}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            <span className="switch-track" aria-hidden="true" />
            <span className="apedit-live-label">
              {form.active ? <><Eye size={12} aria-hidden="true" /> Live</> : <><EyeOff size={12} aria-hidden="true" /> Hidden</>}
            </span>
          </label>
        )}
      >
        <div className="form-group">
          <label htmlFor="p-name">Name <span className="field-req">*</span></label>
          <input
            id="p-name"
            className="glass-input"
            value={form.name}
            onChange={set('name')}
            placeholder="What the customer sees on the shelf"
          />
        </div>

        <div className="form-group">
          <label htmlFor="p-desc">Description</label>
          <textarea
            id="p-desc"
            className="glass-input"
            rows={4}
            value={form.description}
            onChange={set('description')}
            placeholder="Shown under the Description tab on the product page"
          />
          {/* The copy tools sit under the field they would change, and change
              nothing until pressed — see components/admin/ai/DraftTool. A shop
              with none of them switched on renders nothing here. */}
          <CopyAssist
            groupId={isNew ? null : Number(id)}
            text={form.description}
            onReplace={(text) => setForm((f) => ({ ...f, description: text }))}
            onAppend={(text) => setForm((f) => ({
              ...f,
              description: `${f.description.trimEnd()}\n\n${text}`,
            }))}
          />
        </div>

        <div className="apedit-grid">
          <div className="form-group">
            <label htmlFor="p-brand">Brand <span className="field-opt">(optional)</span></label>
            <input id="p-brand" className="glass-input" value={form.brand} onChange={set('brand')} placeholder="—" />
          </div>
          <div className="form-group">
            <label htmlFor="p-cat">Category <span className="field-opt">(optional)</span></label>
            {/* Autofill from the categories that already exist, so reusing one
                is the easy path. A datalist rather than a select because the
                answer is usually an existing category and occasionally a
                brand-new one, and a dropdown cannot express the second — the
                same choice the bulk category bar on the products grid makes.

                Offered only when the tidying setting is on, because the two are
                halves of one idea: showing the names that exist, and folding a
                near-miss onto one of them. */}
            <input
              id="p-cat"
              className="glass-input"
              value={form.category}
              onChange={set('category')}
              placeholder="—"
              list={hints?.category_normalize ? 'p-cat-options' : undefined}
              maxLength={128}
            />
            {hints?.category_normalize && (
              <datalist id="p-cat-options">
                {(hints.categories || []).map((c) => <option key={c} value={c} />)}
              </datalist>
            )}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="p-tags">Tags</label>
          <input
            id="p-tags"
            className="glass-input"
            value={form.tags}
            onChange={set('tags')}
            placeholder="comma, separated, tags"
          />
          {tagList.length > 0 && (
            <div className="apedit-tags">
              {tagList.map((t) => (
                <span key={t} className="apedit-tag"><Tag size={9} aria-hidden="true" /> {t}</span>
              ))}
            </div>
          )}
          {category && suggested.category === category && (
            suggestions.length > 0 ? (
              <div className="apedit-suggest" role="group" aria-label={`Tags other ${category} products use`}>
                <span className="apedit-suggest-label">
                  Other <strong>{category}</strong> products use
                </span>
                <div className="apedit-suggest-chips">
                  {suggestions.map((s, i) => (
                    <button
                      key={s.tag}
                      type="button"
                      className="apedit-suggest-chip"
                      style={{ '--i': Math.min(i, 10) }}
                      onClick={() => addTag(s.tag)}
                      title={`On ${s.uses} other ${s.uses === 1 ? 'product' : 'products'} in ${category}`}
                      // Named explicitly so a screen reader says the tag and
                      // what pressing does, rather than the tooltip or the
                      // bare count.
                      aria-label={`Add tag ${s.tag} (on ${s.uses} other ${s.uses === 1 ? 'product' : 'products'} in ${category})`}
                    >
                      <Plus size={10} aria-hidden="true" />
                      <span className="apedit-suggest-tag">{s.tag}</span>
                      <span className="apedit-suggest-uses" aria-hidden="true">{s.uses}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : suggested.tags.length === 0 ? (
              <p className="apedit-suggest-empty">
                No other <strong>{category}</strong> product carries tags yet — whatever you add here becomes the category's vocabulary.
              </p>
            ) : null
          )}
          {/* Second, and deliberately so: the row above is evidence — a tag
              eleven products already carry is a filter that already works —
              and this one is the answer when the category is empty or none of
              them fit. Same chips, same effect on the field. */}
          <TagAssist
            groupId={isNew ? null : Number(id)}
            existingTags={tagList}
            onAdd={addTag}
          />
        </div>

        <div className="apedit-breakdown">
          <label className={`apedit-live${form.breakdown_enabled ? ' is-on' : ''}`} htmlFor="p-breakdown">
            <input id="p-breakdown" type="checkbox" role="switch"
              checked={form.breakdown_enabled}
              aria-describedby="p-breakdown-help"
              onChange={(e) => setForm(f => ({ ...f, breakdown_enabled: e.target.checked }))} />
            <span className="switch-track" aria-hidden="true" />
            <span className="apedit-live-label">Breakdown</span>
          </label>
          <p id="p-breakdown-help" className="apedit-sub">Let different pack sizes draw from one product stock total.</p>

          {/* ── Bundle ────────────────────────────────────────────────────
           *
           * Beside Breakdown because they are the same kind of decision —
           * what this product IS, rather than what it says — and because they
           * are mutually exclusive in practice: a breakdown group keeps its
           * stock on the group, and a kit is a box with its own count, so the
           * server refuses to build into one. Saying so here is cheaper than
           * letting somebody find out at the Build button.
           *
           * Only offered when the store has bundles switched on. `bundlesOn`
           * is null until the settings request lands, so the switch does not
           * appear and then vanish.
           */}
          {bundlesOn && !form.breakdown_enabled && (
            <>
              <label className={`apedit-live${form.is_bundle ? ' is-on' : ''}`} htmlFor="p-bundle">
                <input id="p-bundle" type="checkbox" role="switch"
                  checked={form.is_bundle}
                  aria-describedby="p-bundle-help"
                  onChange={(e) => setForm(f => ({ ...f, is_bundle: e.target.checked }))} />
                <span className="switch-track" aria-hidden="true" />
                <span className="apedit-live-label">Bundle</span>
              </label>
              <p id="p-bundle-help" className="apedit-sub">
                A kit assembled from other products. Save, then say what goes in it — building takes
                the components off their shelves and puts finished boxes on this one.
              </p>
            </>
          )}
          {bundlesOn && form.breakdown_enabled && form.is_bundle && (
            <p className="apedit-sub">
              This product is marked as a bundle but shares one stock pool across its options, so
              boxes cannot be built into it. Turn breakdown off to build kits.
            </p>
          )}
          {form.breakdown_enabled && (
            <div className="form-group apedit-breakdown-stock">
              <label htmlFor="p-stock">Total stock (base units)</label>
              {/* Hundredths, the same step as the pack amount below it and the
                  same two places the column holds. These used to differ — the
                  total in hundredths, a pack size in thousandths — on the
                  argument that a total is weighed and a pack size is stated;
                  the argument did not survive the observation that nothing
                  typed on this page is in thousandths. */}
              <input id="p-stock" className="glass-input" type="number" min="0" step={UNIT_STEP} max="2147483647"
                value={form.stock_quantity} onChange={set('stock_quantity')} aria-describedby="p-stock-help" />
              <p id="p-stock-help" className="apedit-sub">
                Enter the units available now, for example 10000 toothbrushes or 1000 grams. Set each variant’s
                amount below: a 100 pack takes 100 units; a 10 pack takes 10; a 3.5g eighth takes 3.5.
                Fractions to two decimal places. Variant stock is ignored while breakdown is on.
              </p>
            </div>
          )}
        </div>
      </Section>

      {/* What the kit contains, and the button that assembles some. Renders
          nothing at all unless this product is a bundle AND the store has the
          feature on — the component checks both, so this stays one line. */}
      <BundleRecipe
        groupId={id}
        isBundle={form.is_bundle}
        canBuild={canBuild}
        variants={variants}
      />

      {/* ── Availability ────────────────────────────────────────────────── */}
      <Section
        icon={CalendarClock}
        title="Availability"
        subtitle="When this product appears in the store. Leave the date empty to publish it as soon as it is live."
        right={schedule && (
          <span className={`cat-pub-state${schedule.pending ? ' is-scheduled' : ' is-live'}`}>
            <span className="cat-drop-dot" aria-hidden="true" />
            {schedule.pending ? 'Scheduled' : 'Published'}
          </span>
        )}
      >
        <div className="cat-pub">
          <div className="cat-pub-row">
            <div className="form-group cat-pub-field">
              <label htmlFor="p-publish">Go live at <span className="field-opt">(optional)</span></label>
              <input
                id="p-publish"
                className="glass-input cat-pub-input"
                type="datetime-local"
                value={form.publish_at}
                onChange={set('publish_at')}
              />
            </div>
            {form.publish_at && (
              <button
                type="button"
                className="glass-btn glass-btn-sm"
                onClick={() => setForm((f) => ({ ...f, publish_at: '' }))}
              >
                <X size={13} aria-hidden="true" /> Publish immediately
              </button>
            )}
          </div>

          {/* The Live/Hidden switch and this date are independent gates, and an
              operator who sets one expecting it to override the other gets a
              product nobody can buy on drop night with nothing on screen
              explaining why. */}
          {schedule?.pending && !form.active && (
            <p className="cat-pub-note is-warn">
              <AlertTriangle size={13} aria-hidden="true" />
              This product is also switched to Hidden, which outranks the schedule — it will
              stay invisible after {fullDateTime(schedule.at)} until you set it back to Live.
            </p>
          )}

          {schedule?.pending && (
            <div className="cat-pub-tiers">
              <div className="cat-pub-tiers-head">
                <Users size={12} aria-hidden="true" /> Effective go-live per tier
              </div>

              {schedule.rows.map((tier, idx) => (
                <div
                  key={tier.id}
                  className={`cat-pub-tier${idx === 0 && tier.minutes > 0 ? ' is-first' : ''}`}
                  // The tier's colour is operator data out of the database, so
                  // it arrives as a custom property rather than living in the
                  // stylesheet — which must hold no literal colours at all.
                  style={{ '--cat-tier-color': tier.color || undefined }}
                >
                  <span className="cat-pub-tier-dot" aria-hidden="true" />
                  <span className="cat-pub-tier-name">{tier.name}</span>
                  <span className="cat-pub-tier-offset">{offsetLabel(tier.minutes)}</span>
                  <span className="cat-pub-tier-when">{fullDateTime(tier.opensAt)}</span>
                </div>
              ))}

              <div className="cat-pub-tier">
                <span className="cat-pub-tier-dot" aria-hidden="true" />
                <span className="cat-pub-tier-name">Everyone else</span>
                <span className="cat-pub-tier-offset">at go-live</span>
                <span className="cat-pub-tier-when">{fullDateTime(schedule.at)}</span>
              </div>
            </div>
          )}

          {schedule?.pending && tiersDenied && (
            <p className="cat-pub-note">
              <Info size={13} aria-hidden="true" />
              Tier head starts are not shown because your account cannot read the membership
              tiers. The schedule above still applies, and any tier with early access will
              still get in before {fullDateTime(schedule.at)}.
            </p>
          )}

          {schedule?.pending && !tiersDenied && !schedule.anyEarly && (
            <p className="cat-pub-note">
              <Info size={13} aria-hidden="true" />
              No membership tier has an early-access head start yet, so every buyer sees this
              at the same moment. Head starts are set once per tier, on the{' '}
              {/* Was plain text naming a page that had no such control at all —
                  the tier editor accepted no head start and the API rejected
                  one, so this sentence sent operators looking for a field that
                  did not exist. It exists now, and this points straight at it. */}
              <Link to="/admin/tiers">membership tiers page</Link> — not per product.
            </p>
          )}

          {/* Said out loud, because the alternative is an operator scheduling a
              drop and assuming the store will do the announcing. It will not:
              createProduct suppresses the push and both bot broadcasts for a
              future publish_at (announcing then would name an unreleased
              product and link to a page the drop guard 404s), and there is no
              go-live notifier yet to send one later. */}
          {schedule?.pending && (
            <p className="cat-pub-note">
              <Info size={13} aria-hidden="true" />
              Scheduling does not announce. No "new product" push or bot broadcast goes out for a
              scheduled product — not now, and not automatically at go-live. Announce the drop
              yourself when it lands.
            </p>
          )}

          {!schedule && (
            <p className="cat-pub-note">
              <Info size={13} aria-hidden="true" />
              No schedule: this product is on the shelf as soon as it is set to Live. Setting a
              date hides it from buyers — and from search, the filters and the home page —
              until then, except for membership tiers that carry a head start.
            </p>
          )}
        </div>
      </Section>

      {/* ── Media ───────────────────────────────────────────────────────── */}
      <Section
        icon={ImageIcon}
        title="Media"
        subtitle="Photos and video for the product as a whole. Slots are interchangeable — the first one is the cover used on every card in the store."
      >
        {isNew ? (
          <p className="apedit-locked">
            <Info size={13} aria-hidden="true" />
            Create the product first — media is attached to it, so it needs somewhere to attach to.
          </p>
        ) : (
          <MediaSlots
            scope="group"
            ownerId={id}
            items={images}
            onChange={setImages}
            feed={slotFeed('group', Number(id))}
            feedError={mediaFeed.error}
            onFeedRefresh={mediaFeed.refresh}
          />
        )}
      </Section>

      {/* ── Variants ────────────────────────────────────────────────────── */}
      <Section
        icon={Layers}
        title="Variants"
        subtitle={form.breakdown_enabled ? "Each pack has its own price and description, and takes a set amount from the shared stock." : "Each size, weight or option the product is sold in, with its own price, stock and media."}
        right={!isNew && (
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={() => setVariants((v) => [...v, blankVariant()])}
          >
            <Plus size={13} aria-hidden="true" /> Add variant
          </button>
        )}
      >
        {isNew ? (
          <p className="apedit-locked">
            <Info size={13} aria-hidden="true" />
            One variant is created with the product, named after it. Rename it and add more here
            once the product exists.
          </p>
        ) : variants.length === 0 ? (
          <div className="apedit-empty">
            <Layers size={28} aria-hidden="true" />
            <p>No variants yet — nothing on this product can be bought.</p>
            <button
              type="button"
              className="glass-btn glass-btn-primary glass-btn-sm"
              onClick={() => setVariants([blankVariant()])}
            >
              <Plus size={13} aria-hidden="true" /> Add the first variant
            </button>
          </div>
        ) : (
          <div className="apvars">
            {/* ── Create from ──
                A row of pre-filled forms, not rows: pressing one appends an
                UNSAVED variant with the size (or the price and ladder) already
                in it, which the operator then names, checks and saves through
                exactly the same path as one they typed by hand.

                Above the cards rather than below them, because it is the thing
                somebody is here to do — the list underneath is what they are
                doing it from. Disappears once a new row is open, so there is
                never a half-filled variant on screen beside an offer to make
                another one. */}
            {variantIdeas.length > 0 && (
              <div className="apvar-suggest" role="group" aria-label="Create the next variant from these">
                <span className="apvar-suggest-lead"><Sparkles size={13} aria-hidden="true" /> Create from</span>
                {variantIdeas.map((sg) => (
                  <button
                    key={sg.key}
                    type="button"
                    className="glass-btn glass-btn-sm apvar-suggest-btn"
                    title={sg.hint}
                    onClick={() => setVariants((vs) => [...vs, { ...blankVariant(), ...sg.patch }])}
                  >
                    <Plus size={12} aria-hidden="true" /> {sg.label}
                  </button>
                ))}
              </div>
            )}
            {variants.map((v, i) => (
              <VariantCard
                key={v.id || `new-${i}`}
                variant={v}
                index={i}
                productId={id}
                breakdown={form.breakdown_enabled}
                stockQuantity={form.stock_quantity}
                unitNote={unitNotes[i]}
                onPatch={patchVariant}
                onSave={saveVariant}
                onDelete={deleteVariant}
                saving={savingVariant === i}
                mediaFeed={v.isNew ? null : slotFeed('variant', v.id)}
                mediaFeedError={mediaFeed.error}
                onMediaFeedRefresh={mediaFeed.refresh}
              />
            ))}
          </div>
        )}
      </Section>

      {!isNew && dirty && (
        <div className="apedit-dirtybar" role="status">
          <span><AlertTriangle size={13} aria-hidden="true" /> Unsaved changes to the product details</span>
          <button type="button" className="glass-btn glass-btn-primary glass-btn-sm" onClick={saveProduct} disabled={saving}>
            {saving ? <span className="spinner spinner-inline" /> : <Check size={13} aria-hidden="true" />} Save now
          </button>
        </div>
      )}
    </div>
  );
}
