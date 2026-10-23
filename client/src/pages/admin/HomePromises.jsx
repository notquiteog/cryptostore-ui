import ProgressBar from '../../components/ProgressBar';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  BadgeCheck, Save, Plus, Trash2, ChevronUp, ChevronDown, Eye, ExternalLink,
  RotateCcw, Link2, MessageSquareQuote, UserRound,
} from 'lucide-react';
import { api } from '../../utils/api';
import { changedWithBase } from '../../utils/settingsDiff';
import { reportSettingsError } from '../../utils/settingsConflict';
import PageHeader from '../../components/admin/PageHeader';
import AskAbout from '../../components/admin/AskAbout';
import { PromisesSection } from '../../components/home/StorePromises';
import { PROMISE_ICON_GROUPS, promiseIcon } from '../../config/promiseIcons';
import { STORE_LINK_PICKER } from '../../config/storeLinks';
import HomeWelcomeEditor from '../../components/admin/HomeWelcomeEditor';
import { WELCOME_KEYS, WELCOME_TEXT_FIELDS, welcomeFormValues } from '../../config/homeWelcome';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { hasAdminPermission } from '../../utils/adminPermissions';

/**
 * The editor for the home page's welcome, reviews, and promises sections.
 *
 * ── Why the preview is the real component ─────────────────────────────────
 *
 * It renders `PromisesSection` — the same component the storefront mounts,
 * against the same stylesheet — rather than a mock-up of it. The custom-page
 * editor made the same choice with its markdown pane and for the same reason:
 * a preview that is a second implementation is a preview that will eventually
 * be confidently wrong about the thing it exists to show. It also means the
 * operator sees the stamp, which is most of what this section is, and can
 * replay it without reloading.
 *
 * ── Why the caps are written out here ─────────────────────────────────────
 *
 * `server/config/homeKeys.js` is the authority and it enforces every one of
 * these on write; the numbers below only stop the operator typing past a
 * limit and then being told about it by a toast. `test/promiseIcons.test.mjs`
 * asserts they still agree, because the two failures are both quiet: a client
 * cap that is looser writes a promise the server silently truncates, and a
 * count cap that is looser rejects the whole save with the operator's work
 * still in the form.
 */
const MAX_PROMISES = 8;
const MAX_TITLE = 60;
const MAX_BODY = 220;
const MAX_FIGURE = 18;
const MAX_LINK_LABEL = 32;
const MAX_EYEBROW = 48;
const MAX_HEADING = 90;
const MAX_LEDE = 280;

const KEYS = {
  enabled: 'home_promises_enabled',
  eyebrow: 'home_promises_eyebrow',
  heading: 'home_promises_heading',
  lede: 'home_promises_lede',
  promises: 'home_promises',
};

/**
 * The recent-reviews band, which shares this page because it shares the page
 * it renders on. Same arrangement as the caps above: `server/config/homeKeys.js`
 * is the authority and enforces all of this on write; the numbers here only
 * stop an operator typing past a limit and being told about it by a toast.
 */
const REVIEW_KEYS = {
  enabled: 'home_reviews_enabled',
  heading: 'home_reviews_heading',
  attribution: 'home_reviews_attribution',
  minRating: 'home_reviews_min_rating',
  count: 'home_reviews_count',
};

const MAX_REVIEWS_HEADING = 90;
const MIN_REVIEW_COUNT = 3;
const MAX_REVIEW_COUNT = 12;

/**
 * The attribution modes, with what each one actually publishes spelled out in
 * the option itself.
 *
 * The worked example is static copy rather than a live preview computed here,
 * and that is the point: re-implementing `attributeAuthor` client-side to draw
 * a demo would put the redaction rule in two places, which is precisely the
 * shape of bug that ends with a store publishing handles it believed it had
 * switched off. The server owns the rule; this list only describes it.
 */
const ATTRIBUTION_OPTIONS = [
  {
    value: 'initial',
    label: 'Initial only — a buyer called "mara" appears as "M."',
  },
  {
    value: 'anonymous',
    label: 'Nothing — every quote is unattributed',
  },
  {
    value: 'handle',
    label: 'Full username — a buyer called "mara" appears as "mara"',
  },
];

const EMPTY_PROMISE = () => ({ icon: 'shield-check', title: '', body: '', figure: '', link: '', link_label: '' });

/** Characters left, as a quiet count that turns urgent near the cap. */
function Counter({ value, max }) {
  const used = (value || '').length;
  const tight = used > max * 0.9;
  return (
    <span className={`promise-count${tight ? ' is-tight' : ''}`}>{used}/{max}</span>
  );
}

export default function HomePromises() {
  const { settings, updateTheme } = useTheme();
  const { user } = useAuth();
  const canEdit = hasAdminPermission(user, 'settings.store');
  const [form, setForm] = useState({});
  /* What the server last told us it holds, so Save can send the difference.
     This page carried a dozen keys and PUT all of them, which put a colleague's
     edit to any of them back every time somebody saved one — see
     utils/settingsDiff. */
  const [saved, setSaved] = useState({});
  const [promises, setPromises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [identity, setIdentity] = useState({});
  const [featured, setFeatured] = useState([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [featuredError, setFeaturedError] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(null);
  // Bumping this remounts the preview, which re-arms the stamp. The only way
  // to watch an entrance animation twice is to make the thing enter again.
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    api.get('/settings')
      .then((data) => {
        if (cancelled) return;
        setIdentity({ store_name: data.store_name, store_tagline: data.store_tagline });
        setForm({
          ...welcomeFormValues(data),
          [KEYS.enabled]: data[KEYS.enabled] ?? 'false',
          [KEYS.eyebrow]: data[KEYS.eyebrow] ?? '',
          [KEYS.heading]: data[KEYS.heading] ?? '',
          [KEYS.lede]: data[KEYS.lede] ?? '',
          // Defaults spelled out rather than left undefined so the controls are
          // never uncontrolled on first paint, and so an install that predates
          // the band shows the same values its server would apply.
          [REVIEW_KEYS.enabled]: data[REVIEW_KEYS.enabled] ?? 'false',
          [REVIEW_KEYS.heading]: data[REVIEW_KEYS.heading] ?? '',
          [REVIEW_KEYS.attribution]: data[REVIEW_KEYS.attribution] ?? 'initial',
          [REVIEW_KEYS.minRating]: data[REVIEW_KEYS.minRating] ?? '1',
          [REVIEW_KEYS.count]: data[REVIEW_KEYS.count] ?? '6',
        });
        // The baseline is the SERVER's values, not the defaulted form above: a
        // key the store has never set reads as absent here and as its default
        // in the form, and those two must not compare equal — the first save on
        // a fresh install is what writes the defaults down.
        setSaved(data);
        try {
          const parsed = JSON.parse(data[KEYS.promises] || '[]');
          setPromises(Array.isArray(parsed) ? parsed.map((p) => ({ ...EMPTY_PROMISE(), ...p })) : []);
        } catch {
          setPromises([]);
        }
      })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  useEffect(() => {
    let cancelled = false;
    api.get('/products/featured')
      .then(data => { if (!cancelled) setFeatured(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setFeaturedError(true); })
      .finally(() => { if (!cancelled) setFeaturedLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const patch = (i, changes) => setPromises((ps) => ps.map((p, j) => (j === i ? { ...p, ...changes } : p)));

  /**
   * Reorder by button, not by drag.
   *
   * DESIGN §8 asks for a non-drag path on anything reorderable and treats it
   * as the accessibility floor. Here it is also the whole interface: eight
   * items is a list you can see all of at once, so a drag would add a gesture,
   * a touch long-press and a drop indicator to buy nothing a pair of arrows
   * does not already do in one keystroke.
   */
  const move = (i, delta) => setPromises((ps) => {
    const j = i + delta;
    if (j < 0 || j >= ps.length) return ps;
    const next = ps.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const save = async () => {
    if (!canEdit || saving || loadError) return;
    setSaving(true);
    try {
      // Blank optional fields are dropped rather than stored empty — the
      // server re-serialises the same way, so what is sent is what comes back
      // and the form does not go dirty on its own after a reload.
      const clean = promises
        .filter((p) => (p.title || '').trim())
        .map((p) => {
          const out = { icon: p.icon, title: p.title.trim(), body: (p.body || '').trim() };
          if ((p.figure || '').trim()) out.figure = p.figure.trim();
          if (p.link) {
            out.link = p.link;
            if ((p.link_label || '').trim()) out.link_label = p.link_label.trim();
          }
          return out;
        });
      const welcome = Object.fromEntries(WELCOME_KEYS.map(key => [key, form[key]]));
      for (const field of WELCOME_TEXT_FIELDS) welcome[field.key] = (welcome[field.key] || '').trim().replace(/\s+/g, ' ');
      const next = { ...form, ...welcome, [KEYS.promises]: JSON.stringify(clean) };
      const payload = changedWithBase(next, saved);
      if (!payload) {
        setSaving(false);
        return toast('Nothing to save');
      }
      await api.put('/settings', payload);
      setSaved((s) => ({ ...s, ...next }));
      setForm(current => ({ ...current, ...welcome }));
      updateTheme(welcome);
      toast.success('Home page saved');
    } catch (err) {
      // `loadAttempt` is this page's own reload trigger — the loader below is
      // keyed on it, so bumping it re-reads the settings a conflict just proved
      // were stale.
      reportSettingsError(err, () => setLoadAttempt((n) => n + 1));
    }
    setSaving(false);
  };

  const enabled = form[KEYS.enabled] === 'true';
  const reviewsOn = form[REVIEW_KEYS.enabled] === 'true';
  // Untitled drafts never reach the storefront, so the preview must not show
  // them either — otherwise the operator is looking at a section that will
  // not be the one their buyers get.
  const previewPromises = useMemo(
    () => promises.filter((p) => (p.title || '').trim()),
    [promises],
  );

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--sp-12)' }}>
        <ProgressBar label="Loading home page…" />
      </div>
    );
  }

  if (loadError) return <div className="glass-card empty-state" role="alert">
    <h2>Home page settings unavailable</h2>
    <p>Your saved settings could not be loaded.</p>
    <button className="glass-btn" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Try again</button>
  </div>;

  return (
    <div className="admin-page" style={{ maxWidth: 1080 }}>
      <PageHeader
        icon={BadgeCheck}
        title="Home page"
        subtitle="Customize the welcome section, buyer reviews, and store promises."
      >
        <AskAbout
          question="On the Home page editor in the admin panel, what do the welcome section, the buyer reviews rail and the store promises control, and what should I know before changing them?"
          title="Ask the assistant what the Home page editor controls"
        />
        <button className="glass-btn glass-btn-primary" onClick={save} disabled={saving || !canEdit}>
          <Save size={14} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </PageHeader>

      {!canEdit && <p className="admin-hint">You have read-only access to these settings.</p>}
      <fieldset className="home-page-fields" disabled={saving || !canEdit}>
      <HomeWelcomeEditor form={form} set={set} onReset={welcome => setForm(current => ({ ...current, ...welcome }))}
        products={featured} productsLoading={featuredLoading} productsError={featuredError} settings={{ ...settings, ...identity }} user={user} />

      {/* Reviews follow the welcome and featured products on the storefront. */}
      <div className="glass-card" style={{ marginBottom: 'var(--sp-5)' }}>
        <h3 className="promise-card-title">
          <MessageSquareQuote size={15} /> The reviews band
        </h3>
        <p className="admin-hint">
          Your buyers&apos; own words, over your store&apos;s real rating spread. You do not write
          any of it — the quotes are reviews people left, and the tally beside them counts every
          visible review at every rating, including the ones you would rather not quote. That is
          what makes the band worth reading.
        </p>

        <div className={`setting-row${reviewsOn ? ' is-on' : ''}`}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="setting-row-text">
              <label htmlFor="reviews-on" className="setting-row-title" style={{ cursor: 'pointer' }}>
                <Eye size={15} style={{ color: reviewsOn ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }} />
                Show this band
              </label>
              <div className="setting-row-hint">
                Off by default, and off is the safe answer rather than the shy one. Turning it on
                publishes, on your front door and to anyone who loads it without an account, the
                fact that somebody bought a named product on a knowable date. With it off the
                endpoint serves nothing at all — not the quotes, not the count.
                {reviewsOn && (
                  <>
                    {' '}Live on the{' '}
                    <Link to="/" target="_blank" style={{ color: 'var(--primary)' }}>
                      home page <ExternalLink size={11} style={{ verticalAlign: '-1px' }} />
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
          <label className="switch">
            <input
              id="reviews-on"
              type="checkbox"
              checked={reviewsOn}
              onChange={(e) => set(REVIEW_KEYS.enabled, e.target.checked ? 'true' : 'false')}
            />
            <span className="switch-track" />
          </label>
        </div>

        <div className="form-group">
          <label htmlFor="reviews-heading">
            Heading <Counter value={form[REVIEW_KEYS.heading]} max={MAX_REVIEWS_HEADING} />
          </label>
          <input
            id="reviews-heading"
            className="glass-input"
            value={form[REVIEW_KEYS.heading] || ''}
            maxLength={MAX_REVIEWS_HEADING}
            onChange={(e) => set(REVIEW_KEYS.heading, e.target.value)}
            placeholder="What buyers said"
          />
          <div className="admin-hint">Blank uses &ldquo;What buyers said&rdquo;.</div>
        </div>

        {/* The identity decision, given its own row and its own weight. It is
            the only control on this page that can publish something about a
            person rather than about the store. */}
        <div className="form-group">
          <label htmlFor="reviews-attribution">
            <UserRound size={12} style={{ verticalAlign: '-2px' }} /> How much of a reviewer to show
          </label>
          <select
            id="reviews-attribution"
            className="glass-input"
            value={form[REVIEW_KEYS.attribution] || 'initial'}
            onChange={(e) => set(REVIEW_KEYS.attribution, e.target.value)}
          >
            {ATTRIBUTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div className="admin-hint">
            Applied on the server, before the reviews are sent. Anything this does not disclose
            never reaches the browser at all, so it cannot be read back out of the page.
          </div>
        </div>

        <div className="promise-lead-grid">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="reviews-min-rating">Quote reviews rated at least</label>
            <select
              id="reviews-min-rating"
              className="glass-input"
              value={form[REVIEW_KEYS.minRating] || '1'}
              onChange={(e) => set(REVIEW_KEYS.minRating, e.target.value)}
            >
              <option value="1">1 star — quote everything</option>
              <option value="2">2 stars and up</option>
              <option value="3">3 stars and up</option>
              <option value="4">4 stars and up</option>
              <option value="5">5 stars only</option>
            </select>
            <div className="admin-hint">
              This picks which reviews are quoted. It does not touch the average, the total or the
              bars — those count every visible review whatever you set here, so raising the floor
              cannot make your store look better rated than it is.
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="reviews-count">How many quotes</label>
            <input
              id="reviews-count"
              className="glass-input"
              type="number"
              min={MIN_REVIEW_COUNT}
              max={MAX_REVIEW_COUNT}
              value={form[REVIEW_KEYS.count] ?? '6'}
              onChange={(e) => set(REVIEW_KEYS.count, e.target.value)}
            />
            <div className="admin-hint">
              {MIN_REVIEW_COUNT}&ndash;{MAX_REVIEW_COUNT}. Below three it reads as a pull-quote
              rather than a feed; above twelve the band is taller than the page it is a section of,
              and somebody who wants to read reviews should be on a product.
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card" style={{ marginBottom: 'var(--sp-5)' }}>
        <h3 className="promise-card-title">
          <BadgeCheck size={15} /> The promises band
        </h3>
        <div className={`setting-row${enabled ? ' is-on' : ''}`} style={{ marginBottom: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="setting-row-text">
              <label htmlFor="promises-on" className="setting-row-title" style={{ cursor: 'pointer' }}>
                <Eye size={15} style={{ color: enabled ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }} />
                Show this section
              </label>
              <div className="setting-row-hint">
                Off, the home page draws nothing here and the text below never leaves the server —
                the same deal the custom pages get. Save to apply either way.
                {enabled && (
                  <>
                    {' '}Live on the{' '}
                    <Link to="/" target="_blank" style={{ color: 'var(--primary)' }}>
                      home page <ExternalLink size={11} style={{ verticalAlign: '-1px' }} />
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
          <label className="switch">
            <input
              id="promises-on"
              type="checkbox"
              checked={enabled}
              onChange={(e) => set(KEYS.enabled, e.target.checked ? 'true' : 'false')}
            />
            <span className="switch-track" />
          </label>
        </div>
      </div>

      <div className="glass-card" style={{ marginBottom: 'var(--sp-5)' }}>
        <h3 className="promise-card-title">Headline</h3>
        <p className="admin-hint">
          Optional — leave all three blank and the promises run the full width on their own.
          Write the noun: what you actually sell, and what you actually do about it.
        </p>

        <div className="promise-lead-grid">
          <div className="form-group">
            <label htmlFor="promises-eyebrow">
              Eyebrow <Counter value={form[KEYS.eyebrow]} max={MAX_EYEBROW} />
            </label>
            <input
              id="promises-eyebrow"
              className="glass-input"
              value={form[KEYS.eyebrow] || ''}
              maxLength={MAX_EYEBROW}
              onChange={(e) => set(KEYS.eyebrow, e.target.value)}
              placeholder="Why buy here"
            />
          </div>
          <div className="form-group">
            <label htmlFor="promises-heading">
              Heading <Counter value={form[KEYS.heading]} max={MAX_HEADING} />
            </label>
            <input
              id="promises-heading"
              className="glass-input"
              value={form[KEYS.heading] || ''}
              maxLength={MAX_HEADING}
              onChange={(e) => set(KEYS.heading, e.target.value)}
              placeholder="Every batch tested. Every order sealed."
            />
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="promises-lede">
            Standfirst <Counter value={form[KEYS.lede]} max={MAX_LEDE} />
          </label>
          <textarea
            id="promises-lede"
            className="glass-input promise-lede-input"
            value={form[KEYS.lede] || ''}
            maxLength={MAX_LEDE}
            onChange={(e) => set(KEYS.lede, e.target.value)}
            placeholder="A sentence or two under the heading. What a first-time buyer needs to know before they trust the counter."
            spellCheck="true"
          />
        </div>
      </div>

      <div className="glass-card" style={{ marginBottom: 'var(--sp-5)' }}>
        <div className="promise-card-head">
          <h3 className="promise-card-title" style={{ margin: 0 }}>
            Promises
            <span className="promise-card-count">{promises.length}/{MAX_PROMISES}</span>
          </h3>
          <button
            type="button"
            className="glass-btn glass-btn-sm glass-btn-primary"
            disabled={promises.length >= MAX_PROMISES}
            onClick={() => setPromises((ps) => [...ps, EMPTY_PROMISE()])}
            title={promises.length >= MAX_PROMISES
              ? `Eight is the limit — past that the last promise sits two thumb-flicks below the heading it supports`
              : undefined}
          >
            <Plus size={13} /> Add promise
          </button>
        </div>

        <p className="admin-hint promise-hint">
          A claim, a detail, and — where you have one — the page that backs it. A figure is
          optional and it is a number you can defend: <em>42 batches</em>, <em>24h</em>,{' '}
          <em>zero logs</em>. It is set in the ledger face and lines up down the column, so a
          made-up percentage sits there looking exactly as precise as a real one.
        </p>

        {promises.length === 0 && (
          <div className="empty-state" style={{ padding: 'var(--sp-8) var(--sp-4)' }}>
            <h3>No promises yet</h3>
            <p>
              Each one is a claim and, optionally, the place it can be checked — a lab result,
              a shipping policy, your PGP key. Claims that link somewhere are drawn lit;
              claims that do not are drawn plain, which is the honest difference.
            </p>
          </div>
        )}

        {promises.map((p, i) => {
          const Icon = promiseIcon(p.icon);
          const pickerOpen = iconPickerOpen === i;
          return (
            <div key={i} className="promise-editor">
              <div className="promise-editor-head">
                <button
                  type="button"
                  className={`promise-icon-btn${pickerOpen ? ' is-open' : ''}`}
                  onClick={() => setIconPickerOpen(pickerOpen ? null : i)}
                  aria-expanded={pickerOpen}
                  aria-label={`Change the icon on ${p.title || `promise ${i + 1}`}`}
                  title="Change icon"
                >
                  <Icon size={18} strokeWidth={1.9} />
                </button>

                <span className="promise-editor-name">{p.title || `Promise ${i + 1}`}</span>

                <div className="promise-editor-tools">
                  <button type="button" className="glass-btn glass-btn-sm" disabled={i === 0}
                    onClick={() => move(i, -1)} aria-label={`Move ${p.title || `promise ${i + 1}`} up`}>
                    <ChevronUp size={13} />
                  </button>
                  <button type="button" className="glass-btn glass-btn-sm" disabled={i === promises.length - 1}
                    onClick={() => move(i, 1)} aria-label={`Move ${p.title || `promise ${i + 1}`} down`}>
                    <ChevronDown size={13} />
                  </button>
                  <button type="button" className="glass-btn glass-btn-sm" style={{ color: 'var(--danger)' }}
                    onClick={() => {
                      setPromises((ps) => ps.filter((_, j) => j !== i));
                      setIconPickerOpen(null);
                    }}
                    aria-label={`Remove ${p.title || `promise ${i + 1}`}`}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {pickerOpen && (
                <div className="promise-icon-picker">
                  {PROMISE_ICON_GROUPS.map((group) => (
                    <div key={group.label} className="promise-icon-group">
                      <div className="promise-icon-group-label">{group.label}</div>
                      <div className="promise-icon-grid">
                        {Object.entries(group.icons).map(([id, GroupIcon]) => (
                          <button
                            key={id}
                            type="button"
                            className={`promise-icon-option${p.icon === id ? ' is-on' : ''}`}
                            onClick={() => { patch(i, { icon: id }); setIconPickerOpen(null); }}
                            aria-label={id}
                            aria-pressed={p.icon === id}
                            title={id}
                          >
                            <GroupIcon size={17} strokeWidth={1.9} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="promise-editor-grid">
                <div className="form-group">
                  <label>Claim <Counter value={p.title} max={MAX_TITLE} /></label>
                  <input className="glass-input" value={p.title || ''} maxLength={MAX_TITLE}
                    onChange={(e) => patch(i, { title: e.target.value })}
                    placeholder="Third-party lab tested" />
                </div>
                <div className="form-group">
                  <label>Figure <Counter value={p.figure} max={MAX_FIGURE} /></label>
                  <input className="glass-input" value={p.figure || ''} maxLength={MAX_FIGURE}
                    onChange={(e) => patch(i, { figure: e.target.value })}
                    placeholder="42 batches" />
                </div>
              </div>
              <div className="form-group">
                <label>Detail <Counter value={p.body} max={MAX_BODY} /></label>
                <textarea className="glass-input promise-body-input" value={p.body || ''} maxLength={MAX_BODY}
                  onChange={(e) => patch(i, { body: e.target.value })}
                  placeholder="One or two sentences. What the claim actually means for the person reading it."
                  spellCheck="true" />
              </div>

              <div className="promise-editor-grid">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label><Link2 size={12} style={{ verticalAlign: '-2px' }} /> Proof link</label>
                  <select
                    className="glass-input"
                    value={p.link || ''}
                    onChange={(e) => patch(i, { link: e.target.value })}
                  >
                    <option value="">No link — a statement, drawn plain</option>
                    {STORE_LINK_PICKER.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}{l.note ? ` — ${l.note}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Link text <Counter value={p.link_label} max={MAX_LINK_LABEL} /></label>
                  <input className="glass-input" value={p.link_label || ''} maxLength={MAX_LINK_LABEL}
                    disabled={!p.link}
                    onChange={(e) => patch(i, { link_label: e.target.value })}
                    placeholder={p.link ? 'See the certificates' : 'Pick a destination first'} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="glass-card">
        <div className="promise-card-head">
          <h3 className="promise-card-title" style={{ margin: 0 }}>Preview</h3>
          <button type="button" className="glass-btn glass-btn-sm" onClick={() => setReplay((r) => r + 1)}>
            <RotateCcw size={13} /> Replay the stamp
          </button>
        </div>
        <p className="admin-hint">
          The real section, not a mock-up — same component, same stylesheet, same motion your
          buyers get. Links to unpublished pages are dropped here exactly as they are on the
          storefront, so a promise whose proof link has vanished is telling you the page is off.
        </p>

        {previewPromises.length === 0 ? (
          <div className="empty-state" style={{ padding: 'var(--sp-8) var(--sp-4)' }}>
            <h3>Nothing to draw yet</h3>
            <p>A promise appears here once it has a claim written on it.</p>
          </div>
        ) : (
          <div className="promise-preview">
            <PromisesSection
              key={replay}
              eyebrow={form[KEYS.eyebrow]}
              heading={form[KEYS.heading]}
              lede={form[KEYS.lede]}
              promises={previewPromises}
            />
          </div>
        )}
      </div>
      </fieldset>
    </div>
  );
}
