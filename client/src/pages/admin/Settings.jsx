import ProgressBar from '../../components/ProgressBar';
import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SETTING_CHANGED } from '../../utils/settingsEvents';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import AgeGate from '../../components/AgeGate';
import toast from 'react-hot-toast';
import {
  Save, Download, Image, FlaskConical, Server, X, Clock,
  ShieldCheck, DoorOpen, Eye, AlertTriangle, CalendarDays, MousePointerClick,
  Mail, Banknote, UserPlus, Ticket, Users, Lock, Settings as SettingsIcon,
  PackageSearch, Bell, Gauge, Timer, TrendingDown, Boxes, PanelBottom, Globe, Siren, Clock3,
  RefreshCw, ClipboardList, Wallet,
  Send, MessageCircle, MessagesSquare, Network, Star, Truck, FileSpreadsheet, Search, Route,
  Package, MapPinOff, PauseCircle, Radar,
} from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';
import SettingsShell from '../../components/admin/SettingsShell';
// One rule for what a Save button sends: the difference, never the whole form.
import { changedWithBase } from '../../utils/settingsDiff';
// One sentence for "somebody else changed this while you were looking", shared
// by every page that writes settings — see utils/settingsConflict.
import { reportSettingsError } from '../../utils/settingsConflict';
import SettingsConflict from '../../components/admin/SettingsConflict';
// "Somebody else just changed a key you are holding", heard rather than
// discovered on save — see hooks/useSettingsWatch.
import useSettingsWatch from '../../hooks/useSettingsWatch';
import CsvTools from '../../components/admin/CsvTools';
import TrackingSettings from '../../components/admin/TrackingSettings';
import ProxyPoolSettings from '../../components/admin/ProxyPoolSettings';
import { STORE_LINK_PICKER } from '../../config/storeLinks';
import { SETTING_GROUPS } from '../../config/settingGroups';
// Which card sits in which chapter, and in what order — the page's table of contents.
import { SETTINGS_CHAPTERS, PLACED_SECTIONS } from '../../config/settingsChapters';
import { canAccessAdminPath } from '../../utils/adminPermissions';
import AskAbout from '../../components/admin/AskAbout';
import AddressRetentionNote from '../../components/admin/AddressRetentionNote';

/**
 * "What does this do?" — one section's own question, put to the assistant.
 *
 * ── Why a button on every card ─────────────────────────────────────────────
 *
 * The shop's manual already exists (`server/services/ai/helpChunks.js`): a
 * staff-audience chunk for the bench, the pools, the proxy route, the
 * tracking floor, and the assistant reads it when a member of staff asks. The
 * admin already has the companion in its sidebar. What was missing was the
 * moment of asking: an operator reading a card called "Fulfilment" with nine
 * switches on it, wondering which one makes tracking mandatory, had to leave
 * the card, find the animal, and type the card's name into it.
 *
 * So the card asks for them. The question names the section, which is what
 * retrieval needs to land on the right chunk.
 *
 * The button, the capability gate and the event are now
 * `components/admin/AskAbout` — this page wrote them first and was for a while
 * the only page that had them, which is how the risk board and catalogue
 * health ended up with the same argument and no button. What stays here is
 * the QUESTION, because the phrasing is this page's knowledge: "in the store
 * settings" is what puts retrieval on a settings chunk rather than on the
 * shop's own numbers.
 */
function AskAboutSection({ title }) {
  if (!title) return null;
  return (
    <AskAbout
      question={`In the store settings, what does the "${title}" section control, and what should I know before changing anything in it?`}
      title={`Ask the assistant what the ${title} section does`}
    />
  );
}

/**
 * A card on this page, and the unit the admin search addresses.
 *
 * This page used to carry its own search box, which filtered the cards in
 * place and built its index by walking their rendered text. That search now
 * lives in the admin nav, works across every admin route, and reads
 * `utils/adminSearchIndex.js` — so what is left here is not a filter but an
 * ADDRESS: `data-settings-section` is how a result arriving from another page
 * finds the card it was pointing at.
 *
 * Addressing by SECTION rather than by row is still deliberate where a control
 * has nothing narrower to aim at. A setting lifted out of its card loses the
 * paragraph that says what turning it on costs, and the settings on this page
 * are exactly the kind where that paragraph is the important half — "Allow
 * browsing without an account" on its own is a switch; next to its warning it
 * is a decision.
 */

/**
 * What a bot is doing, and a way to kick it.
 *
 * Sits in the head of the Telegram and Potato cards because that is where the
 * token is — an operator who suspects the bot is down is already looking at
 * this card, and had, until now, no way to tell from it.
 *
 * The state that matters is `stopped`: enabled, has a token, and not running.
 * That is what a restart leaves behind when the bot fails to come up, and it
 * used to be completely invisible — the bot answered chat commands while
 * silently delivering no notifications, and the risk board reported it as
 * connected because it asked a different question. Both now read the same
 * signal the notification helpers gate on.
 */
function BotStatus({ bot, canRestart, onRestart, busy }) {
  if (!bot) return null;

  const tone = {
    running: { color: 'var(--success)', label: 'Running' },
    // Its own tone, not "running", because it is the state that used to be
    // invisible: process up, token fine, restart button reporting success, and
    // nothing heard for minutes. See utils/botLiveness on the server.
    deaf: { color: 'var(--warning)', label: 'Not responding' },
    stopped: { color: 'var(--danger)', label: 'Not running' },
    no_token: { color: 'var(--warning)', label: 'No token' },
    off: { color: 'var(--text-muted)', label: 'Off' },
  }[bot.state] || { color: 'var(--text-muted)', label: bot.state };

  // How long since the bot last heard from its API, in words. A running bot
  // says this too — an operator asking "is it working?" is better served by
  // "heard 4s ago" than by a green dot that means "it started once".
  const since = bot.health?.secondsSincePoll;
  const heard = since === null || since === undefined ? null
    : since < 90 ? `heard ${since}s ago`
      : since < 3600 ? `heard ${Math.round(since / 60)}m ago`
        : `heard ${Math.round(since / 3600)}h ago`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-25)', flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-15)', fontSize: 'var(--fs-sm)', color: tone.color }}>
        <span aria-hidden="true" style={{
          width: '0.5rem', height: '0.5rem', borderRadius: '50%',
          background: 'currentColor', flexShrink: 0,
        }} />
        {tone.label}
        {bot.username && <span style={{ color: 'var(--text-muted)' }}>@{bot.username}</span>}
        {bot.route && bot.route !== 'direct' && (
          <span style={{ color: 'var(--text-muted)' }}>· via {bot.route === 'tor' ? 'Tor' : 'the proxy pool'}</span>
        )}
        {heard && <span style={{ color: 'var(--text-muted)' }}>· {heard}</span>}
      </span>
      {/* Inline mode is off until somebody runs /setinline in BotFather, and
          getMe is the only place that says so. Said once, plainly, where the
          token is configured — and said as information, because typed /search
          works either way. */}
      {bot.health?.inlineSearch === false && (
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          · inline search off (BotFather <code>/setinline</code> turns it on; <code>/search</code> works regardless)
        </span>
      )}
      {canRestart && bot.enabled && bot.configured && (
        <button
          type="button"
          className="glass-btn glass-btn-secondary"
          style={{ fontSize: 'var(--fs-sm)' }}
          onClick={onRestart}
          disabled={busy}
        >
          <RefreshCw size={13} /> {busy ? 'Restarting…' : 'Restart'}
        </button>
      )}
    </div>
  );
}

/**
 * One titled group of settings.
 *
 * `data-settings-section` is LOAD-BEARING and is why this component cannot be
 * simplified away: the admin nav's search resolves a result by querying for
 * the attribute, AdminLayout glows the target on arrival, and
 * client/test/adminSearch.test.mjs fails if it disappears. Nothing on this
 * page reads it, which is exactly how an attribute gets tidied away by
 * somebody who cannot see what uses it.
 *
 * It sat beside a `data-keywords` that the same comment called load-bearing
 * and that nothing read — not the nav, not the resolver, not the test. The
 * search words belong in the index, next to the entry that is matched against
 * them, and that is where they now are; an attribute defended by a comment
 * that names no reader is worse than no attribute, because it survives every
 * tidy-up on the strength of the comment alone.
 *
 * The head is new. Every card used to be a bare `<h3>` over a stack of fields
 * at one elevation, so fourteen sections read as fourteen boxes rather than as
 * a document with parts; a rule under the title and a lede beneath it is what
 * makes a section look like a section.
 */
function SettingsSection({
  id, title, icon: Icon, lede, className, headAction, children,
}) {
  return (
    <section
      className={`glass-card aset-card${className ? ` ${className}` : ''}`}
      data-settings-section={id}
      aria-labelledby={title ? `aset-h-${id}` : undefined}
    >
      {title && (
        <div className="aset-card-head">
          <h3 className="aset-card-title" id={`aset-h-${id}`}>
            {Icon && <Icon size={17} aria-hidden="true" />}
            {title}
            <AskAboutSection title={title} />
          </h3>
          {headAction}
          {lede && <p className="aset-card-lede">{lede}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * The hand-written cards, by section id: what the rail calls each one and the
 * icon beside it.
 *
 * Ids are the SAME `data-settings-section` values the admin nav's search
 * resolves against — the rail navigates by the attribute that already
 * existed rather than introducing a second addressing scheme that could drift
 * from it. Anything here with no matching card is simply not rendered by the
 * observer, so a section hidden behind a permission does not leave a dead
 * link.
 *
 * The label is the card's own title, verbatim. The rail used to say
 * "Payments" for a card headed "Payment methods" and "Orders" for one whose
 * id is `features`, so the word the operator clicked was never the word at
 * the top of where they landed; `client/test/adminSearch.test.mjs` now holds
 * the two to the same string. Data-driven groups need no entry — their title
 * is their id, and their icon is in `GROUP_ICONS`.
 *
 * WHERE each card sits is not decided here: that is `config/settingsChapters.js`.
 */
const HAND_SECTIONS = {
  branding: { label: 'Branding & PWA', icon: Image },
  access: { label: 'Access & entry', icon: DoorOpen },
  payments: { label: 'Payment methods', icon: Banknote },
  features: { label: 'Orders', icon: ClipboardList },
  fulfilment: { label: 'Fulfilment', icon: Boxes },
  'package-tracking': { label: 'Package tracking', icon: Truck },
  'address-lookup': { label: 'Address lookup', icon: Search },
  pricing: { label: 'Pricing', icon: Wallet },
  'stock-alerts': { label: 'Stock alerts', icon: PackageSearch },
  'ops-alerts': { label: 'Operations alerts', icon: Siren },
  'outbound-proxies': { label: 'Outbound proxies', icon: Route },
  mirrors: { label: 'Mirrors', icon: Globe },
  footer: { label: 'Footer', icon: PanelBottom },
  seo: { label: 'Search engines', icon: Radar },
  // CsvTools draws its own card, so this is the one label with no
  // <SettingsSection title> to match.
  csv: { label: 'Import & export', icon: FileSpreadsheet },
};



/**
 * A labelled on/off switch.
 *
 * Store settings are strings, not booleans, and every consumer compares against
 * the literal 'true' — so the conversion lives here rather than at each call
 * site.
 */
function SwitchRow({ id, title, hint, icon: Icon, checked, onChange, tone, children }) {
  return (
    <div className={`setting-row${checked ? ' is-on' : ''}`}>
      <div className="setting-row-main">
        <div className="setting-row-text">
          <label htmlFor={id} className="setting-row-title" style={{ cursor: 'pointer' }}>
            {Icon && <Icon size={15} style={{ color: checked ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }} />}
            {title}
          </label>
          <div className="setting-row-hint">{hint}</div>
        </div>
        {checked && children && <div className="setting-row-extra">{children}</div>}
      </div>
      <label className={`switch${tone === 'warn' ? ' switch-warn' : ''}`}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="switch-track" />
      </label>
    </div>
  );
}

/**
 * Days of cover, said the way a person would say it.
 *
 * The server sends the number; only the phrasing lives here. "0.29 days" is
 * technically the answer and practically useless — under a day it becomes
 * hours, and a variant with no believable velocity says how many units are left
 * rather than inventing a duration from two sales in a fortnight.
 */
function coverLabel(item) {
  if (item.quantity <= 0) return 'out of stock';
  if (item.days_of_cover === null || item.days_of_cover === undefined) return 'no sales history';
  if (item.days_of_cover < 1) return `~${Math.max(1, Math.round(item.days_of_cover * 24))}h of cover`;
  // One decimal only where it says something: "~3.5d" is a different fact from
  // "~3d", but "~3.0d" is just noise with a point in it.
  const rounded = Math.round(item.days_of_cover * 10) / 10;
  const days = rounded < 10 && rounded % 1 !== 0 ? rounded.toFixed(1) : Math.round(rounded);
  return `~${days}d of cover`;
}

// Pushed into the theme context before opening the preview, so the gateway
// shows the wording currently in the form rather than the last saved wording.
const AGE_GATE_KEYS = [
  'age_gate_enabled', 'age_gate_min_age', 'age_gate_title', 'age_gate_message',
  'age_gate_decline_url', 'age_gate_remember_days', 'age_gate_require_dob',
];

/**
 * What the storefront footer may link to. Ids, never URLs — the server
 * enforces the same roster (config/pageKeys.js), so nothing an operator
 * stores here can point a visitor off the store's own routes.
 *
 * Read from `config/storeLinks.js`, which is also what the footer itself
 * resolves against and what the home page's promises editor offers. This
 * list used to be written out here as well, one page rename away from
 * offering a destination the footer no longer knew how to draw.
 */
const FOOTER_LINK_ROSTER = STORE_LINK_PICKER;

/**
 * The eleven data-driven cards, from `config/settingGroups.js`.
 *
 * They live there rather than here because the admin nav's search index reads
 * the same array to generate one entry per group. Written out on this page,
 * they were searchable only if somebody also remembered to hand-write them
 * into the index — and for eleven sections, nobody had.
 */
const settingGroups = SETTING_GROUPS;

/**
 * The rail, assembled in the order the page actually renders.
 *
 * The eleven data-driven sections in the middle — the bots, push, security,
 * Tor, reviews, shipping, developer — come from `settingGroups` rather than
 * from a second hand-written list, because a hand-written one is a list that
 * drifts. A group added to `settingGroups` and forgotten here would render a
 * card the rail could not reach, which on a page this long is a card nobody
 * finds; deriving it means that cannot happen.
 *
 * `id` is the group TITLE because that is what `SettingsSection` is already
 * given as its `data-settings-section`, and the rail navigates by that
 * attribute rather than inventing a second addressing scheme beside it.
 */
/**
 * An icon per data-driven group, keyed by the group's own title.
 *
 * One map rather than two, because there were two: the rail derived its
 * entries from `settingGroups` and gave them none, while the card carried an
 * inline `title === 'Product import' ? Download : title === 'Developer' ? …`
 * that special-cased exactly two of the eleven. So nine sections had no icon
 * anywhere and two had one in the card but not beside it in the rail — the
 * same section wearing a different face depending on where you looked at it.
 *
 * Keyed on the title because that is already this group's identity: it is what
 * `SettingsSection` receives as its id and what the rail navigates by. A group
 * with no entry here simply gets no icon, which is the honest degradation —
 * the rail entry and the card still render, they are just plainer.
 */
const GROUP_ICONS = {
  // The two groups that had no icon: a rail row with an icon beside eleven
  // without one is a row that reads as a different kind of entry.
  Catalog: Package,
  'Address privacy': MapPinOff,
  'Product import': Download,
  Telegram: Send,
  'Potato chat': MessageCircle,
  // The switches deciding what staff may do FROM a chat, which is a permission
  // question rather than a bot one — hence the shield rather than a third
  // message bubble beside the two above it.
  'Staff actions on the bots': ShieldCheck,
  'Live chat': MessagesSquare,
  'Push notifications': Bell,
  Security: Lock,
  // Onion routing: a path through a network, not a padlock. Security already
  // has the padlock, and two locks side by side would say the same thing twice
  // about two different decisions.
  'Tor proxy': Network,
  Reviews: Star,
  Shipping: Truck,
  Developer: FlaskConical,
};

/**
 * The three ways a piece of outbound traffic can leave. One list for every
 * `route` field, mirroring server/services/outboundRoute.js — a consumer
 * that offered a fourth word here would be a consumer the server refuses.
 */
const ROUTE_OPTIONS = [
  { value: 'direct', label: 'Directly from this server' },
  { value: 'tor', label: 'Through Tor — the local SOCKS proxy on 9050/9150' },
  { value: 'proxies', label: 'Through the outbound proxy pool — your external residential, mobile or workplace IPs' },
];

/** What a `route` select shows: the saved route, else the unset default. */
const routeValue = (settings, field) => settings[field.key] || 'direct';

/**
 * The rail, chapter by chapter, from the same list the page renders from.
 *
 * A section id that is neither a hand-written card nor a data-driven group
 * gets a bare label and no icon — the honest degradation, and the adminSearch
 * test names it before it ships.
 */
const railEntry = (id) => ({
  id,
  label: HAND_SECTIONS[id]?.label || id,
  icon: HAND_SECTIONS[id]?.icon || GROUP_ICONS[id],
});
const RAIL_CHAPTERS = SETTINGS_CHAPTERS.map((chapter) => ({
  ...chapter,
  sections: chapter.sections.map(railEntry),
}));

/** Where a group lands when settingGroups.js has it and settingsChapters.js does not. */
const UNFILED_CHAPTER = {
  id: 'unfiled',
  label: 'Not yet filed',
  lede: 'Cards that exist but have no chapter yet — file them in config/settingsChapters.js.',
  sections: [],
};

/**
 * One chapter: a heading, its lede, and the cards under it.
 *
 * A <section> around the cards rather than a heading dropped between them, so
 * assistive tech reads the page as eight named regions rather than
 * twenty-seven cards in a row — which is also the reading the rail gives a
 * sighted operator.
 */
function SettingsChapter({ chapter, children }) {
  return (
    <section className="aset-chapter" aria-labelledby={`aset-ch-${chapter.id}`}>
      <h2 className="aset-chapter-title" id={`aset-ch-${chapter.id}`}>{chapter.label}</h2>
      {chapter.lede && <p className="aset-chapter-lede">{chapter.lede}</p>}
      {children}
    </section>
  );
}

/**
 * The settings that live on their own admin route, because each is the size
 * of a page. The same roster the assistant's manual keeps under
 * `help-set-elsewhere` (server/services/ai/manual/settings.js): an operator
 * who came to Settings for the theme should leave by a link, not by scanning
 * the sidebar. Filtered by the same permission map the sidebar uses, so a
 * link never points at a page the reader would be bounced from.
 */
const ELSEWHERE_PAGES = [
  { path: '/admin/theme', label: 'Theme', what: 'colours, glass, fonts, presets and profiles' },
  { path: '/admin/home', label: 'Home page', what: 'which rails appear, and in what order' },
  { path: '/admin/pages', label: 'Pages', what: 'about, privacy, shipping, FAQ, lab results' },
  { path: '/admin/ai', label: 'AI', what: 'model connections, capabilities, the index' },
  { path: '/admin/limits', label: 'Rate limits', what: 'a cap and a window per action' },
  { path: '/admin/nodes', label: 'Nodes', what: 'each coin\'s RPC, wallet and route' },
  { path: '/admin/pgp', label: 'Store PGP key', what: 'signs receipts and the canary, decrypts addresses' },
  { path: '/admin/canary', label: 'Canary', what: 'the statement and how often it is renewed' },
  { path: '/admin/users', label: 'Staff permissions', what: 'what each role may see and do' },
  { path: '/admin/api-keys', label: 'API keys', what: 'keys that may write the catalogue' },
];

function ElsewherePages({ user }) {
  const pages = ELSEWHERE_PAGES.filter((p) => canAccessAdminPath(user, p.path));
  if (pages.length === 0) return null;
  return (
    <aside className="aset-elsewhere" aria-labelledby="aset-elsewhere-h">
      <h2 className="aset-chapter-title" id="aset-elsewhere-h">On their own pages</h2>
      <p className="aset-chapter-lede">
        Each of these is the size of a page, so it has one. The search at the top of the sidebar
        finds a single setting on any of them.
      </p>
      <ul className="aset-elsewhere-list">
        {pages.map((p) => (
          <li key={p.path}>
            <Link to={p.path} className="aset-elsewhere-link">
              <strong>{p.label}</strong>
              <span>{p.what}</span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}


/**
 * What the stage names mean to the person waiting.
 *
 * `fetching` is separated from `importing` because it is the one that can take
 * minutes with nothing to count — on a filtered network the feed request is
 * most of the wait, and "Importing… 0 of ?" for three minutes is the reading an
 * operator interprets as a hang.
 */
const IMPORT_PHASES = {
  starting: 'Starting…',
  fetching: 'Fetching the feed…',
  importing: 'Importing…',
  cancelled: 'Stopping…',
  done: 'Finishing…',
};

const importElapsed = (from, to = Date.now()) => {
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
};

/**
 * The import, while it runs and just after.
 *
 * ── Why this is a panel and not a spinner ──────────────────────────────────
 *
 * A catalogue pull is minutes of work, and the only thing this page used to say
 * about it was the word "Importing…". That is enough to know a job exists and
 * not enough to answer any question an operator actually has: how far in is it,
 * is it moving, is it creating or updating, has it been failing on every row
 * since the start? Those are the questions that decide whether to wait or to
 * cancel, and all of them were unanswerable.
 *
 * Everything here is read from the server each poll — see the poll effect in
 * AdminSettings — so this renders identically in a tab that pressed Import, a
 * tab that was refreshed halfway through, and a second operator's browser.
 *
 * The bar is rendered indeterminate until the feed has been read, because the
 * total genuinely is not known until then, and a bar that pretends to be at 0%
 * of nothing is worse than one that admits it is still fetching.
 */
function ImportProgress({ status, onDismiss }) {
  const run = status?.run;
  const last = status?.last;
  // A ticking clock, so a run that is between products still looks alive. Only
  // while something is running: an interval that outlives the import is a
  // re-render a second for the life of the tab.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!run) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [run]);

  if (!run && !last) return null;

  if (run) {
    const known = Number.isFinite(run.total) && run.total > 0;
    const pct = known ? Math.min(100, Math.round((run.processed / run.total) * 100)) : null;
    return (
      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
        <div className="glass-plate" style={{ padding: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'baseline' }}>
            <strong style={{ fontSize: 'var(--fs-base)' }}>
              {IMPORT_PHASES[run.phase] || 'Importing…'}
              {run.source === 'schedule' && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · scheduled run</span>}
            </strong>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              {known ? `${run.processed} of ${run.total}` : `${run.processed} so far`} · {importElapsed(run.startedAt)}
            </span>
          </div>

          {/* Indeterminate until the feed has been counted — see the header. */}
          <div
            role="progressbar"
            aria-label="Product import progress"
            {...(pct == null ? {} : { 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 })}
            style={{ height: 6, borderRadius: 999, background: 'var(--surface-2, rgba(255,255,255,.08))', overflow: 'hidden' }}
          >
            <div style={{
              height: '100%',
              width: pct == null ? '35%' : `${pct}%`,
              borderRadius: 999,
              background: 'var(--accent)',
              transition: 'width .4s ease',
              ...(pct == null ? { animation: 'var(--anim-indeterminate, none)', opacity: 0.6 } : {}),
            }} />
          </div>

          <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            <span><strong style={{ color: 'var(--success)' }}>{run.created}</strong> created</span>
            <span><strong>{run.updated}</strong> updated</span>
            {run.failed > 0 && <span><strong style={{ color: 'var(--danger)' }}>{run.failed}</strong> failed</span>}
          </div>

          {/* The product it is on. This is what tells an operator the run is
              moving rather than stuck, and which product it is stuck ON. */}
          {run.current && (
            <p className="admin-hint" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Currently: {run.current}
            </p>
          )}
          {status?.cancelRequested && (
            <p className="admin-hint" style={{ margin: 0 }}>Cancelling — the run will stop after the current product.</p>
          )}
        </div>
      </div>
    );
  }

  // Finished. Kept on screen rather than cleared, because the operator who
  // refreshed mid-run is exactly the person who never saw the result.
  const tone = last.outcome === 'failed' ? 'var(--danger)' : last.outcome === 'cancelled' ? 'var(--warning)' : 'var(--success)';
  return (
    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
      <div className="glass-plate" style={{ padding: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <strong style={{ fontSize: 'var(--fs-base)', color: tone }}>
            {last.outcome === 'failed' ? 'Last import failed' : last.outcome === 'cancelled' ? 'Last import cancelled' : 'Last import finished'}
          </strong>
          <button type="button" className="glass-btn glass-btn-sm glass-btn-secondary" onClick={onDismiss}>Dismiss</button>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          <span><strong>{last.created}</strong> created</span>
          <span><strong>{last.updated}</strong> updated</span>
          {last.failed > 0 && <span><strong style={{ color: 'var(--danger)' }}>{last.failed}</strong> failed</span>}
          <span>{importElapsed(last.startedAt, last.finishedAt)}</span>
          {last.source === 'schedule' && <span>scheduled run</span>}
        </div>
        {last.error && <p className="admin-hint" style={{ margin: 0, color: 'var(--danger)' }}>{last.error}</p>}
        {/* The rows that failed, named. "Imported 0 groups, 0 variants" with no
            reason is the complaint the CSV importer's own header records; this
            half of the feature deserved the same fix. */}
        {last.errors?.length > 0 && (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 'var(--fs-xs)' }}>
              {last.errors.length === last.failed ? `${last.errors.length} failed` : `first ${last.errors.length} of ${last.failed} failures`}
            </summary>
            <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: 'var(--sp-5)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              {last.errors.map((e, i) => (
                <li key={i}>{typeof e === 'string' ? e : `${e.product ? `${e.product}: ` : ''}${e.error}`}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}


// ── Main Settings page ───────────────────────────────────────────
export default function AdminSettings() {
  const { user } = useAuth();
  const { updateTheme } = useTheme();
  const [settings, setSettings] = useState({});
  /*
   * What the server last gave us, for the dirty comparison.
   *
   * State, not a ref. It WAS a ref, on the reasoning that nothing displays it
   * directly and writing it should not re-render the page — and that reasoning
   * is wrong in both halves. The baseline is half of every comparison the save
   * bar's count is made of, so it is displayed; and writing a ref schedules no
   * render, so a successful save had no way to reach `changedKeys`. That memo
   * keys on `settings`, saving does not touch `settings`, and the bar therefore
   * went on saying "6 unsaved changes" over six settings the server had already
   * stored — until some unrelated edit happened to invalidate the memo. An
   * operator who then pressed Discard lost nothing and learned nothing, which
   * is how this looked like a save that had not gone through.
   *
   * The page has always PUT the ENTIRE settings object, which is why this is
   * needed at all — without a baseline there is no way to tell an operator
   * what they are about to commit, and a page left open across a distraction
   * would post whatever happened to be in it.
   */
  const [savedSettings, setSavedSettings] = useState({});
  /**
   * Carriers and box presets are stored as JSON but edited as a comma list —
   * the operator is naming five things, not authoring a document. Held as
   * local text so a half-typed entry is not parsed on every keystroke; parsed
   * and pushed into `settings` on blur, and the server re-validates and
   * normalises whatever arrives (config/fulfilmentKeys.js).
   */
  const [carriersText, setCarriersText] = useState('');
  const [presetsText, setPresetsText] = useState('');
  // Where sealed cartons go. A comma list like the carriers one, and empty by
  // default — an operator who never opens this never sees a staging field at
  // the bench. See config/fulfilmentKeys.js.
  const [placesText, setPlacesText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [previewAgeGate, setPreviewAgeGate] = useState(false);
  // The stock-alert preview: what the scanner would be alerting on right now,
  // at the numbers currently in the form rather than the numbers last saved.
  // `status` is a small state machine because "no products are alerting" and
  // "you are not allowed to ask" have to look different on screen — a zero in
  // both places would tell an operator their catalog is healthy when in fact
  // nobody answered.
  const [stockPreview, setStockPreview] = useState(null);
  const [stockPreviewStatus, setStockPreviewStatus] = useState('loading');
  const [stockPreviewBusy, setStockPreviewBusy] = useState(false);
  // Read inside the poll, which closes over the render that started it — the
  // state variable there would be the value from before Import was pressed.
  const importingRef = useRef(false);
  useEffect(() => { importingRef.current = importing; }, [importing]);

  // Bot status, polled while the page is open.
  //
  // Polled rather than fetched once because the interesting transition happens
  // without the operator doing anything: a bot that was running stops when a
  // token is revoked or a Tor circuit goes away, and a page showing a stale
  // "Running" is the same lie this whole panel exists to stop telling.
  const [botStatus, setBotStatus] = useState(null);
  // The alert thresholds, as the server defines them. Empty until the
  // request lands and empty forever if it fails — see the fetch below.
  const [opsThresholds, setOpsThresholds] = useState([]);
  const [restartingBot, setRestartingBot] = useState(null);

  /* The alert thresholds the server defines, fetched once.
   *
   * Deliberately NOT part of `loadBotStatus` below, which is polled every few
   * seconds: this list changes when the code changes, not while somebody is
   * looking at the page, and polling it would be a request per tick for an
   * answer that cannot have moved.
   *
   * Silent on failure. The card degrades to its two switches and the briefing
   * hour — the controls that matter most — rather than the whole settings page
   * showing an error about a list of numbers. */
  useEffect(() => {
    let alive = true;
    api.get('/settings/ops-alerts')
      .then((d) => { if (alive) setOpsThresholds(d?.thresholds || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const loadBotStatus = useCallback(() => {
    api.get('/settings/bots/status')
      .then((d) => setBotStatus(Object.fromEntries((d.bots || []).map((b) => [b.name, b]))))
      // Silent: an operator who lacks the grant should see no status rather
      // than an error on a page that is mostly about something else.
      .catch(() => setBotStatus(null));
  }, []);

  useEffect(() => {
    loadBotStatus();
    const id = setInterval(loadBotStatus, 15000);
    return () => clearInterval(id);
  }, [loadBotStatus]);

  const restartBot = async (which) => {
    setRestartingBot(which);
    try {
      const d = await api.post(`/settings/bots/${which.toLowerCase()}/restart`);
      // The endpoint answers 200 whether or not the bot came up, and says
      // which — so the toast reports the outcome rather than the button press.
      if (d.running) toast.success(d.message);
      else toast.error(d.message);
      loadBotStatus();
    } catch (err) {
      toast.error(err.message || 'Could not restart the bot');
    } finally {
      setRestartingBot(null);
    }
  };
  const isAdmin = user?.role === 'admin';


  const stockWindowDays = settings.stock_alert_window_days ?? '14';
  const stockCoverDays = settings.stock_alert_days_of_cover ?? '7';
  const stockScanMinutes = settings.stock_alert_scan_minutes ?? '30';
  const stockFloorQty = settings.low_stock_threshold ?? '5';
  const stockAlertsOn = settings.stock_alert_enabled === 'true';

  /* Re-read the stored settings.
   *
   * Extracted from the mount effect below so a conflict — and the live "somebody
   * else changed this" notice — can ask for the truth again. It was an anonymous
   * effect body, which meant the only way to see a colleague's change was to
   * reload the browser. */
  const load = useCallback(() => {
    api.get('/settings')
      .then(data => {
        setSettings(data || {});
        setSavedSettings({ ...(data || {}) });
        // Seed the two comma-list editors from the stored JSON. Defensive
        // parse: a hand-edited row shows an empty field rather than taking the
        // whole settings page down.
        try {
          const carriers = JSON.parse(data?.ship_carriers || '[]');
          setCarriersText(Array.isArray(carriers) ? carriers.join(', ') : '');
        } catch { setCarriersText(''); }
        try {
          const presets = JSON.parse(data?.pack_box_presets || '[]');
          setPresetsText(Array.isArray(presets)
            ? presets.map(p => (p?.tare_grams != null ? `${p.name}:${p.tare_grams}` : p?.name)).filter(Boolean).join(', ')
            : '');
        } catch { setPresetsText(''); }
        try {
          const places = JSON.parse(data?.pack_staging_places || '[]');
          setPlacesText(Array.isArray(places) ? places.join(', ') : '');
        } catch { setPlacesText(''); }
      })
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);




  // ── The import's progress is read, not remembered ────────────────────────
  //
  // This poll is the whole reason an import now survives a refresh. The run
  // lives on the server (server/services/importState.js) and this page renders
  // whatever it finds there, so loading Settings halfway through an import
  // shows the import halfway through — rather than an idle "Run Import Now"
  // button beside a job that is very much running.
  //
  // Two seconds while something is in flight, five when nothing is. The fast
  // cadence is because a progress bar that updates every five seconds looks
  // stuck on a quick feed; the idle one stays at the five seconds it always
  // was, because an import can be started by the SCHEDULER or by another
  // operator, and the idle poll is how this page finds out. Slowing it down
  // to save requests would have traded a real delay for nothing.
  const importRunning = importing || !!importStatus?.isRunning;
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      api.get('/admin/products/import-status')
        .then((status) => {
          if (cancelled) return;
          setImportStatus((previous) => {
            // A run that ENDED between two polls is the case the old code could
            // not report at all: the toast lived in the tab that pressed the
            // button, so an operator who refreshed never found out how it went.
            // Announced from the transition rather than from `last` alone, so
            // reopening the page later does not re-announce an old import.
            const wasRunning = previous?.isRunning || importingRef.current;
            if (wasRunning && !status.isRunning && status.last) announceImport(status.last);
            return status;
          });
          if (!status.isRunning) setImporting(false);
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, importRunning ? 2000 : 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [importRunning]);

  // Re-ask the server what would be alerting whenever a threshold moves.
  //
  // Debounced, because the answer costs a catalog-wide aggregate over the order
  // history and the natural way to change "7" to "14" is to type a 1 and then a
  // 4 — an un-debounced version fires a full scan on the intermediate "1". The
  // timer is cleared on every change and the in-flight result is discarded by
  // `cancelled`, so a slow response for an old threshold can never overwrite a
  // fast one for the current threshold.
  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    setStockPreviewBusy(true);

    const timer = setTimeout(() => {
      const params = new URLSearchParams({ preview: '1' });
      // Blank fields are sent as absent rather than as 0, so an operator
      // mid-edit sees the preview for the stored value instead of a preview for
      // a threshold of nothing.
      if (String(stockWindowDays).trim() !== '') params.set('window_days', stockWindowDays);
      if (String(stockCoverDays).trim() !== '') params.set('days_of_cover', stockCoverDays);
      if (String(stockFloorQty).trim() !== '') params.set('threshold', stockFloorQty);

      api.get(`/admin/low-stock?${params.toString()}`)
        .then((data) => {
          if (cancelled) return;
          setStockPreview(data);
          setStockPreviewStatus('ready');
        })
        .catch((err) => {
          if (cancelled) return;
          // Settings are delegated per area, so somebody can hold
          // `settings.shipping` and not `products.stock`. They may still tune
          // the thresholds; they just cannot be shown the catalog behind them.
          setStockPreviewStatus(err.status === 403 ? 'denied' : 'error');
        })
        .finally(() => { if (!cancelled) setStockPreviewBusy(false); });
    }, 350);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [loading, stockWindowDays, stockCoverDays, stockFloorQty]);

  function formatNextSync(ts) {
    if (!ts) return null;
    const diff = ts - Date.now();
    if (diff <= 0) return 'soon';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return `in ${h}h ${m}m`;
    if (m > 0) return `in ${m}m`;
    return 'in <1m';
  }

  function formatLastRun(ts) {
    if (!ts) return null;
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    const m = Math.floor(diff / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m ago`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h ago`;
  }

  const handleChange = (key, value) => setSettings(s => ({ ...s, [key]: value }));

  /*
   * A key changed somewhere else — the assistant's settings card, pressed with
   * this page open behind it. This page saves every key it loaded, so without
   * this a later Save would write the stale value straight back over the one
   * just changed (utils/settingsEvents.js has the whole failure).
   *
   * The baseline always takes the new value, because it is what is stored. The
   * draft takes it only if the operator had not edited that key here: if they
   * had, their edit stays and now correctly reads as a change against what the
   * server holds, rather than being silently replaced.
   */
  const savedRef = useRef(savedSettings);
  savedRef.current = savedSettings;
  useEffect(() => {
    const onChanged = (e) => {
      const { key, value } = e.detail || {};
      if (typeof key !== 'string' || typeof value !== 'string') return;
      const before = savedRef.current?.[key];
      setSavedSettings((base) => ({ ...base, [key]: value }));
      setSettings((draft) => (String(draft[key] ?? '') === String(before ?? '') ? { ...draft, [key]: value } : draft));
    };
    window.addEventListener(SETTING_CHANGED, onChanged);
    return () => window.removeEventListener(SETTING_CHANGED, onChanged);
  }, []);

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const result = await api.upload('/settings/upload-logo', formData);
      const updated = { ...settings, store_logo: result.path };
      setSettings(updated);
      updateTheme(updated);
      toast.success('Logo uploaded');
    } catch (err) {
      toast.error(err.message || 'Upload failed');
    }
    setUploadingLogo(false);
    e.target.value = '';
  };

  /*
   * Which keys differ from what is stored.
   *
   * Compared as strings because every store setting IS a string on the wire —
   * `'true'`, `'14'`, a hex, a JSON blob — and a loose comparison would call
   * `14` and `'14'` different on a page where the number inputs hand back
   * whichever they feel like.
   *
   * Union of both key sets, not just the draft's: a key the operator BLANKED
   * is a change, and iterating only over `settings` would miss one that had
   * been deleted from the object entirely.
   */
  const changedKeys = useMemo(() => {
    const base = savedSettings || {};
    const keys = new Set([...Object.keys(base), ...Object.keys(settings)]);
    const out = [];
    for (const k of keys) {
      // Secret fields answer '' from the GET by design (write-only), so an
      // untouched password box would otherwise read as a change on every
      // render. An empty draft value against an empty baseline is no change,
      // which is what this comparison already gives — but a `_configured`
      // companion is read-only and must never count.
      if (k.endsWith('_configured')) continue;
      if (String(base[k] ?? '') !== String(settings[k] ?? '')) out.push(k);
    }
    return out;
    // Both sides, or the count answers to whichever one the last render
    // happened to change — which is exactly how a save stopped clearing it.
  }, [settings, savedSettings]);

  const discardChanges = () => {
    setSettings({ ...savedSettings });
    // The two comma-list editors hold their own text state, so restoring the
    // settings object alone would leave them showing the edited string over
    // reverted data — the shape of "it says it discarded and it did not".
    try {
      const carriers = JSON.parse(savedSettings?.ship_carriers || '[]');
      setCarriersText(Array.isArray(carriers) ? carriers.join(', ') : '');
    } catch { setCarriersText(''); }
    try {
      const presets = JSON.parse(savedSettings?.pack_box_presets || '[]');
      setPresetsText(Array.isArray(presets)
        ? presets.map(p => (p?.tare_grams != null ? `${p.name}:${p.tare_grams}` : p?.name)).filter(Boolean).join(', ')
        : '');
    } catch { setPresetsText(''); }
    try {
      const places = JSON.parse(savedSettings?.pack_staging_places || '[]');
      setPlacesText(Array.isArray(places) ? places.join(', ') : '');
    } catch { setPlacesText(''); }
    toast('Changes discarded');
  };

  const handleSave = async () => {
    // Only what this operator actually changed.
    //
    // This page holds roughly two hundred keys and used to PUT all of them, so
    // a save wrote back every setting the page had loaded — including the ones
    // somebody else had edited in the meantime, silently putting their work
    // back. It also meant a save needed every permission this page can reach,
    // because the controller rejects the whole PUT if any single key is out of
    // scope. `utils/settingsDiff` carries the full argument.
    // `changedWithBase`, not `changedSettings`: the payload carries what this
    // form was showing for each key it is changing, so the server can refuse
    // rather than overwrite when somebody else has moved one in the meantime.
    const payload = changedWithBase(settings, savedSettings);
    if (!payload) {
      setSaving(false);
      return toast('Nothing to save');
    }
    const changes = payload.__base;
    setSaving(true);
    try {
      await api.put('/settings', payload);
      // The baseline moves to what the form now shows, which is what it holds
      // after a successful write of the difference between the two.
      setSavedSettings({ ...settings });
      updateTheme(settings);
      const n = Object.keys(changes).length;
      toast.success(`Saved ${n} change${n === 1 ? '' : 's'}`);
    } catch (err) {
      reportSettingsError(err, load, setConflicts);
    }
    setSaving(false);
  };

  /* ── A colleague got there first ──
   *
   * `conflicts` is what the server refused on: per key, what this form was
   * showing, what it tried to write, and what is actually stored. The panel
   * puts both on screen and the two handlers below are the whole of the choice.
   *
   * Taking theirs writes nothing — it moves the form AND the baseline onto the
   * stored value, so the key stops being a difference and the next Save leaves
   * it alone. Keeping mine moves only the baseline, so the key is still a
   * change and the next Save carries it, now with a baseline the server will
   * accept. Neither writes anything on its own; the operator still presses
   * Save, which is what keeps "overwrite a colleague" a deliberate act.
   */
  const [conflicts, setConflicts] = useState([]);
  // Every key this form is holding. `settings` IS the form, so its key list is
  // exactly what going stale would matter for.
  const watch = useSettingsWatch(useMemo(() => Object.keys(settings), [settings]));

  const takeTheirs = (c) => {
    setSettings((cur) => ({ ...cur, [c.key]: c.theirs }));
    setSavedSettings((cur) => ({ ...cur, [c.key]: c.theirs }));
    setConflicts((cur) => cur.filter((x) => x.key !== c.key));
  };

  const keepMine = (c) => {
    setSavedSettings((cur) => ({ ...cur, [c.key]: c.theirs }));
    setConflicts((cur) => cur.filter((x) => x.key !== c.key));
  };

  /**
   * How a finished run is reported, wherever the page learns about it.
   *
   * One function because there are now two ways to find out: the operator was
   * watching, or they came back to the page afterwards. Both deserve the same
   * sentence, and a cancelled import must not be dressed up as a failure — it
   * is what the operator asked for, and the products it did import are real.
   */
  const announceImport = (last) => {
    if (!last) return;
    const tally = `${last.created} created, ${last.updated} updated`;
    if (last.outcome === 'failed') return toast.error(`Import failed: ${last.error || 'unknown error'}`);
    if (last.outcome === 'cancelled') return toast(`Import cancelled after ${tally}`);
    if (last.failed > 0) return toast(`Import finished with ${last.failed} error${last.failed === 1 ? '' : 's'} · ${tally}`);
    toast.success(`Import complete: ${tally}`);
  };

  /**
   * Start an import. The request returns as soon as the run has started.
   *
   * It used to hold the POST open for the whole import and report from its
   * response, which meant the progress existed only in this tab: a refresh lost
   * it while the server kept importing. The run is now started server-side and
   * the poll above renders it, so this function's job ends at "it started".
   */
  const handleImport = async () => {
    if (!settings['scrape_url']) return toast.error('Set an Import API URL first');
    setImporting(true);
    try {
      // Import commits whatever is unsaved before it runs, so it has to adopt
      // the same baseline. Without this the bar kept claiming unsaved changes
      // over settings the server had just been handed — and Discard would then
      // have rolled the form back to values that were no longer what was
      // stored. Same difference-only PUT as Save, for the same reasons.
      const pending = changedWithBase(settings, savedSettings);
      if (pending) await api.put('/settings', pending);
      setSavedSettings({ ...settings });
      const started = await api.post('/admin/products/import', {});
      // Rendered from the 202's own snapshot so the bar appears at once rather
      // than on the next poll.
      if (started?.run) setImportStatus((s) => ({ ...(s || {}), ...started }));
    } catch (err) {
      setImporting(false);
      toast.error(err.message);
    }
  };

  const handleDeleteAllProducts = async () => {
    const typed = window.prompt(
      'Delete ALL products? This deactivates every product group and variant.\n\n' +
      'Type the following phrase exactly to confirm:\n\nDELETE ALL PRODUCTS'
    );
    if (typed !== 'DELETE ALL PRODUCTS') {
      if (typed !== null) toast.error('Confirmation text did not match — nothing deleted');
      return;
    }
    try {
      const result = await api.delete('/admin/products/all', { confirm: 'DELETE ALL PRODUCTS' });
      toast.success(result.message || 'All products soft-deleted');
    } catch (err) {
      toast.error(err.message);
    }
  };

  /**
   * Ask the run to stop at the next product boundary.
   *
   * No longer aborts a request: there is no long-lived request to abort, and
   * aborting one never stopped the import anyway — it only stopped this tab
   * hearing about it, which is precisely the confusion this page had. The
   * server-side flag is what actually ends the loop, and the poll reports the
   * cancellation when it takes effect.
   */
  const handleCancelImport = async () => {
    try {
      await api.post('/admin/products/import-cancel', {});
      toast('Stopping after the current product…');
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 'var(--sp-12)' }}>
      <ProgressBar label="Loading settings…" />
    </div>
  );

  /*
   * ── Every card, keyed by its section id ─────────────────────────────────
   *
   * The cards are written below in whatever order they were written, and the
   * page renders them in the order `config/settingsChapters.js` decides —
   * chapter by chapter, four or so cards each — rather than in source order.
   * They used to be inline in the return, in source order, with the thirteen
   * data-driven groups as one block in the middle; so Catalog rendered after
   * the Tor proxy and the shipping tiers after Address privacy, because that
   * is where they had been typed. Moving a card between chapters is now one
   * line in the chapters file, and the rail follows.
   *
   * A map rather than a switch, so `cardFor` below can say "no such card"
   * for a chapter entry that points at nothing — which the adminSearch test
   * catches statically, and which renders as nothing rather than throwing.
   */
  const renderGroup = (group) => (
        <SettingsSection
          key={group.title}
          id={group.title}
          title={group.title}
          icon={GROUP_ICONS[group.title]}
          tight
          headAction={(group.title === 'Telegram' || group.title === 'Potato chat') ? (
            <BotStatus
              bot={botStatus?.[group.title === 'Telegram' ? 'Telegram' : 'Potato']}
              canRestart={isAdmin || (user?.permissions || []).includes('settings.bots')}
              busy={restartingBot === (group.title === 'Telegram' ? 'Telegram' : 'Potato')}
              onRestart={() => restartBot(group.title === 'Telegram' ? 'Telegram' : 'Potato')}
            />
          ) : group.title === 'Product import' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                {/* Last run info */}
                {importStatus?.lastRun && !importStatus?.isRunning && (
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
                    Last run {formatLastRun(importStatus.lastRun)}
                  </span>
                )}
                {/* Next sync info */}
                {settings['import_schedule_enabled'] === 'true' && importStatus?.nextRun && !importStatus?.isRunning && (
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
                    <Clock size={12} /> Next sync {formatNextSync(importStatus.nextRun)}
                  </span>
                )}
                {/* How the last run ended, for someone who was not watching. */}
                {importStatus?.last && !importStatus?.isRunning && importStatus.last.outcome !== 'ok' && (
                  <span style={{ fontSize: 'var(--fs-xs)', color: importStatus.last.outcome === 'failed' ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {importStatus.last.outcome === 'failed' ? 'Last run failed' : 'Last run cancelled'}
                  </span>
                )}
                {/* Active import indicator */}
                {(importing || importStatus?.isRunning) && (
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
                    <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                    {IMPORT_PHASES[importStatus?.run?.phase] || 'Importing…'}
                  </span>
                )}
                {importing || importStatus?.isRunning ? (
                  <button className="glass-btn glass-btn-secondary glass-btn-danger" onClick={handleCancelImport} style={{ fontSize: 'var(--fs-base)' }}>
                    <X size={14} /> Cancel
                  </button>
                ) : (
                  <button className="glass-btn glass-btn-secondary" onClick={handleImport} style={{ fontSize: 'var(--fs-base)' }}>
                    <Download size={14} /> Run Import Now
                  </button>
                )}
                {settings['developer_mode'] === 'true' && (
                  <button className="glass-btn glass-btn-secondary glass-btn-danger" onClick={handleDeleteAllProducts} style={{ fontSize: 'var(--fs-base)' }}>
                    <X size={14} /> Delete All Products
                  </button>
                )}
              </div>
            )}
        >
          {group.title === 'Product import' && (
            <ImportProgress status={importStatus} onDismiss={() => setImportStatus((s) => ({ ...(s || {}), last: null }))} />
          )}
          {/* What the selected retention window would actually delete, counted
              against the unsaved value — the Stock alerts card's preview shape,
              for the same reason: a dropdown reading "90 days" asks somebody to
              authorise a deletion whose size they cannot see. */}
          {group.title === 'Address privacy' && (
            <AddressRetentionNote days={settings.address_retention_days} />
          )}
          {group.fields.map(field => (

            <div key={field.key} className="form-group">
              <label>{field.label}</label>
              {field.type === 'text' && (
                <input className="glass-input" value={settings[field.key] || ''}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder || ''} />
              )}
              {field.type === 'password' && (
                <div>
                  {settings[`${field.key}_configured`] === 'true' && (
                    <small style={{ color: 'var(--success, #4ade80)', display: 'block', marginBottom: 'var(--sp-1)' }}>
                      Currently set — leave blank to keep existing value
                    </small>
                  )}
                  <input className="glass-input" type="password" value={settings[field.key] || ''}
                    autoComplete="new-password"
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={settings[`${field.key}_configured`] === 'true' ? '••••••••' : ''} />
                </div>
              )}
              {field.type === 'toggle' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', cursor: 'pointer' }}>
                  <input type="checkbox"
                    checked={settings[field.key] === 'true' || settings[field.key] === true}
                    onChange={(e) => handleChange(field.key, e.target.checked ? 'true' : 'false')}
                    style={{ accentColor: 'var(--primary)' }} />
                  {(settings[field.key] === 'true' || settings[field.key] === true) ? 'Enabled' : 'Disabled'}
                </label>
              )}
              {field.type === 'select' && (
                <select className="glass-input"
                  value={settings[field.key] || (field.options?.[0]?.value ?? '')}
                  onChange={(e) => handleChange(field.key, e.target.value)}>
                  {field.options?.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
              {/* Where this consumer's traffic leaves from. Replaces the old
                  "through Tor" toggle; shows what that toggle implied until a
                  route is saved, and saves the route key rather than the
                  toggle. The pool itself is under Outbound proxies. */}
              {field.type === 'route' && (
                <select className="glass-input"
                  value={routeValue(settings, field)}
                  onChange={(e) => handleChange(field.key, e.target.value)}>
                  {ROUTE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
              {/* A one-line "why you would touch this". Security settings that
                  arrive with no explanation get left at their default by
                  operators who cannot tell what changing them costs, which is
                  the same outcome as not shipping the control. */}
              {field.hint && (
                <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: 'var(--sp-15)' }}>
                  {field.hint}
                </small>
              )}
              {field.type === 'shipping_tiers' && (() => {
                let tiers = [];
                try { tiers = JSON.parse(settings[field.key] || '[]'); } catch {}
                const updateTiers = (t) => handleChange(field.key, JSON.stringify(t));
                return (
                  <div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 'var(--sp-3)' }}>
                      <thead>
                        <tr style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' }}>
                          <th style={{ textAlign: 'left', paddingBottom: 'var(--sp-15)', fontWeight: 500 }}>Min items in cart</th>
                          <th style={{ textAlign: 'left', paddingBottom: 'var(--sp-15)', fontWeight: 500 }}>Shipping ($)</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {tiers.map((tier, i) => (
                          <tr key={i}>
                            <td style={{ paddingBottom: 'var(--sp-2)', paddingRight: 'var(--sp-2)' }}>
                              <input className="glass-input" type="number" min="0" value={tier.min_qty}
                                onChange={(e) => { const t=[...tiers]; t[i]={...t[i],min_qty:parseInt(e.target.value)||0}; updateTiers(t); }}
                                style={{ margin: 0 }} />
                            </td>
                            <td style={{ paddingBottom: 'var(--sp-2)', paddingRight: 'var(--sp-2)' }}>
                              <input className="glass-input" type="number" min="0" step="0.01" value={tier.price}
                                onChange={(e) => { const t=[...tiers]; t[i]={...t[i],price:parseFloat(e.target.value)||0}; updateTiers(t); }}
                                style={{ margin: 0 }} />
                            </td>
                            <td style={{ paddingBottom: 'var(--sp-2)' }}>
                              <button type="button" className="glass-btn glass-btn-danger glass-btn-sm"
                                onClick={() => updateTiers(tiers.filter((_, j) => j !== i))}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button type="button" className="glass-btn glass-btn-sm"
                      onClick={() => updateTiers([...tiers, { min_qty: 1, price: 0 }])}>
                      + Add Tier
                    </button>
                  </div>
                );
              })()}
            </div>
          ))}
        </SettingsSection>
  );

  const cards = {
    branding: (
      /* Branding & PWA */
      <SettingsSection
        id="branding"
        title="Branding & PWA"
        icon={Image}
      >
        <div className="form-group">
          <label>Store Logo</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
            {settings.store_logo ? (
              <img src={settings.store_logo} alt="Store logo"
                style={{ height: 72, width: 'auto', maxWidth: 220,
                  borderRadius: settings.favicon_rounded === 'true' ? '50%' : 'var(--radius-sm)',
                  border: '1px solid var(--border)', background: 'var(--surface)', padding: 4, objectFit: 'contain' }} />
            ) : (
              <div style={{ width: 72, height: 72, borderRadius: 'var(--radius-sm)',
                border: '1px dashed var(--border)', background: 'var(--surface)',
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Image size={24} style={{ color: 'var(--text-muted)' }} />
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              <input type="file" accept="image/*" id="logo-upload" onChange={handleLogoUpload} style={{ display: 'none' }} />
              <label htmlFor="logo-upload" className="glass-btn glass-btn-sm" style={{ cursor: 'pointer' }}>
                {uploadingLogo ? 'Uploading…' : settings.store_logo ? 'Change Logo' : 'Upload Logo'}
              </label>
              {settings.store_logo && (
                <button type="button" className="glass-btn glass-btn-sm glass-btn-danger"
                  onClick={() => { setSettings(s => ({ ...s, store_logo: '' })); updateTheme({ store_logo: '' }); }}>
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="form-group">
          <label>Round Favicon / Logo</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.favicon_rounded === 'true'}
              onChange={(e) => handleChange('favicon_rounded', e.target.checked ? 'true' : 'false')}
              style={{ accentColor: 'var(--primary)' }} />
            {settings.favicon_rounded === 'true' ? 'Enabled (circular)' : 'Disabled (square)'}
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 'var(--sp-4)' }}>
          {[
            { key: 'store_name', label: 'Store Name', placeholder: 'CryptoStore' },
            { key: 'store_tagline', label: 'Store Tagline', placeholder: 'Your Trusted Marketplace' },
            { key: 'pwa_name', label: 'PWA App Name', placeholder: settings.store_name || 'CryptoStore' },
            // Placeholders name the value that ACTUALLY applies when the field
            // is blank, which for all three is the store's own name or the
            // page background. They used to show 'Store' and the pre-Ledger
            // cyan/near-black pair (#22d3ee / #04060d) — colours no install has
            // shipped since the palette overhaul, offered to the operator as if
            // leaving the box empty would produce them.
            { key: 'pwa_short_name', label: 'PWA Short Name', placeholder: settings.store_name || 'CryptoStore' },
            { key: 'pwa_description', label: 'PWA Description', placeholder: '' },
          ].map(f => (
            <div key={f.key} className="form-group" style={{ marginBottom: 0 }}>
              <label>{f.label}</label>
              <input className="glass-input" value={settings[f.key] || ''}
                onChange={(e) => handleChange(f.key, e.target.value)} placeholder={f.placeholder} />
            </div>
          ))}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>PWA Display Mode</label>
            <select className="glass-input" value={settings.pwa_display || 'standalone'}
              onChange={(e) => handleChange('pwa_display', e.target.value)}>
              <option value="standalone">Standalone</option>
              <option value="fullscreen">Fullscreen</option>
              <option value="minimal-ui">Minimal UI</option>
              <option value="browser">Browser</option>
            </select>
          </div>
          {[
            { key: 'pwa_theme_color', label: 'PWA Theme Color', placeholder: settings.theme_bg || '#111113' },
            { key: 'pwa_background_color', label: 'PWA Background Color', placeholder: settings.theme_bg || '#111113' },
          ].map(f => (
            <div key={f.key} className="form-group" style={{ marginBottom: 0 }}>
              <label>{f.label}</label>
              <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
                <input type="color" value={settings[f.key] || '#000000'}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                  style={{ width: 40, height: 36, border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: 'transparent' }} />
                <input className="glass-input" value={settings[f.key] || ''}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                  style={{ flex: 1 }} placeholder={f.placeholder} />
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>
    ),
    access: (
      /* Access & entry — who may reach the storefront, and on what terms.

          `title` is a STRING here and must stay one. It was
          `{<>Access &amp; Entry</>}`, and `AskAboutSection` interpolates this
          prop into the question it puts to the assistant — so the button on
          this card asked what the "[object Object]" section controls, which
          is a question `help-set-access` (stamped `Where: Settings →
          "Access & entry"`) can never be retrieved by. A prop is a JS string:
          the entity was never needed. `aiHelpCorpus` now asserts it. */
      <SettingsSection
        id="access"
        title="Access & entry"
        icon={DoorOpen}
        lede="Controls what a visitor sees before they have an account, and what they must confirm before they see anything at all."
      >
        <SwitchRow
          id="registration-enabled"
          icon={UserPlus}
          title="Allow new account registration"
          hint="Turn off to close signups entirely. Existing accounts keep working and can still sign in; only the creation of new ones stops."
          checked={settings.registration_enabled !== 'false'}
          onChange={(v) => handleChange('registration_enabled', v ? 'true' : 'false')}
        >
          <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
            <SwitchRow
              id="require-invite"
              icon={Ticket}
              title="Require an invite code"
              hint="Nobody can create an account without a live invite code. Customer invite links keep working; this only removes the open signup path."
              checked={settings.require_invite === 'true'}
              onChange={(v) => handleChange('require_invite', v ? 'true' : 'false')}
            >
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
                  <Users size={13} /> Which invites are accepted
                </label>
                <select
                  id="registration-invite-source"
                  className="glass-input"
                  value={settings.registration_invite_source ?? 'any'}
                  onChange={(e) => handleChange('registration_invite_source', e.target.value)}
                >
                  <option value="any">Any invite — staff-issued or customer</option>
                  <option value="admin">Staff-issued invites only (from the Invite Links page)</option>
                  <option value="user">Customer invites only</option>
                </select>
                <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-15)', lineHeight: 1.55 }}>
                  {settings.registration_invite_source === 'admin'
                    ? 'Customers cannot bring in their own sub-users — every account is admitted by staff. Existing customer invite links stop working at signup.'
                    : settings.registration_invite_source === 'user'
                      ? 'Growth is customer-driven: an account can only be created through another customer’s invite link, and always arrives as their sub-user.'
                      : 'Both staff invites and customer invite links admit a new account.'}
                </small>
                <small style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', display: 'block', marginTop: 'var(--sp-1)', lineHeight: 1.5 }}>
                  An invite is classified when it is created, so changing a staff member’s role
                  later never reclassifies invites they have already handed out.
                </small>
              </div>
            </SwitchRow>
          </div>
        </SwitchRow>

        {settings.registration_enabled === 'false' && (
          <div className="form-group" style={{ marginTop: 'calc(var(--sp-1) * -1)', marginBottom: 'var(--sp-4)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
              <Lock size={13} /> Message shown to visitors
            </label>
            <input
              id="registration-closed-message"
              className="glass-input"
              value={settings.registration_closed_message ?? ''}
              onChange={(e) => handleChange('registration_closed_message', e.target.value)}
              placeholder="New account registration is currently closed."
              maxLength={200}
            />
            <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
              Shown on the registration page and returned by the API. Leave blank for the default wording.
            </small>
          </div>
        )}

        {/* The till, not the door. Mirrors the registration pair above: a
            switch, and a message that only appears once the switch is on.
            `tone="warn"` because on is the state that costs the shop money,
            and the row should look like it while it is. What it stops is
            said in the hint rather than left to be discovered, because
            "paused" reads as "closed" and closed is exactly what it is not. */}
        <SwitchRow
          id="store-paused"
          icon={PauseCircle}
          tone="warn"
          title="Pause new orders"
          hint="Stops new orders only, on the web and on the bots. Browsing, carts, existing orders, support and disputes all carry on; the checkout shows your message in place of the Place order button, and a bar under the navbar says the shop is not taking orders."
          checked={settings.store_paused === 'true'}
          onChange={(v) => handleChange('store_paused', v ? 'true' : 'false')}
        >
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="store-paused-message" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
              <Lock size={13} /> Message shown to buyers
            </label>
            <textarea
              id="store-paused-message"
              className="glass-input"
              rows={3}
              value={settings.store_paused_message ?? ''}
              onChange={(e) => handleChange('store_paused_message', e.target.value)}
              placeholder="The store is not taking orders right now."
              maxLength={500}
            />
            <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
              Shown in the bar on every storefront page, at the checkout, and by the bots when someone tries to order.
              Say when you expect to be back if you know. Leave blank for the default wording. Up to 500 characters.
            </small>
          </div>
        </SwitchRow>

        <SwitchRow
          id="allow-guest-browsing"
          icon={Eye}
          tone="warn"
          title="Allow browsing without an account"
          hint="Signed-out visitors can view the home page and the catalog. The cart, checkout, orders, wishlist and support always require a login, and guest prices never include per-account tier discounts."
          checked={settings.allow_guest_browsing === 'true'}
          onChange={(v) => handleChange('allow_guest_browsing', v ? 'true' : 'false')}
        >
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--warning)', display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-15)', margin: 0, lineHeight: 1.55 }}>
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 'var(--sp-05)' }} />
            Your product names, images, descriptions and prices become visible to anyone who
            reaches the site — including search engines and anyone who is handed the address.
          </p>
        </SwitchRow>

        <SwitchRow
          id="age-gate-enabled"
          icon={ShieldCheck}
          title="Age verification gateway"
          hint="Blocks the storefront behind an age confirmation until the visitor answers. Remembered per browser; the admin panel is never gated."
          checked={settings.age_gate_enabled === 'true'}
          onChange={(v) => handleChange('age_gate_enabled', v ? 'true' : 'false')}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 'var(--sp-4)' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="age-gate-min">Minimum age</label>
              <input
                id="age-gate-min"
                className="glass-input"
                type="number"
                min="1"
                max="129"
                value={settings.age_gate_min_age ?? '21'}
                onChange={(e) => handleChange('age_gate_min_age', e.target.value)}
              />
              <small style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', display: 'block', marginTop: 'var(--sp-1)' }}>
                Raising this re-asks everyone who only confirmed the old, lower age.
              </small>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="age-gate-remember">Remember for (days)</label>
              <input
                id="age-gate-remember"
                className="glass-input"
                type="number"
                min="0"
                value={settings.age_gate_remember_days ?? '30'}
                onChange={(e) => handleChange('age_gate_remember_days', e.target.value)}
              />
              <small style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', display: 'block', marginTop: 'var(--sp-1)' }}>
                0 asks again on every new browser session.
              </small>
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}>
            <label htmlFor="age-gate-title">Headline</label>
            <input
              id="age-gate-title"
              className="glass-input"
              value={settings.age_gate_title || ''}
              onChange={(e) => handleChange('age_gate_title', e.target.value)}
              placeholder={`Are you ${settings.age_gate_min_age || 21} or older?`}
            />
          </div>

          <div className="form-group" style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}>
            <label htmlFor="age-gate-message">Message</label>
            <textarea
              id="age-gate-message"
              className="glass-input"
              rows={2}
              value={settings.age_gate_message || ''}
              onChange={(e) => handleChange('age_gate_message', e.target.value)}
              placeholder={`You must be ${settings.age_gate_min_age || 21} or over to enter ${settings.store_name || 'this store'}.`}
              style={{ resize: 'vertical' }}
            />
            <small style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', display: 'block', marginTop: 'var(--sp-1)' }}>
              Leave both blank to use the wording shown as placeholder text.
            </small>
          </div>

          <div className="form-group" style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}>
            <label htmlFor="age-gate-decline">Send visitors who decline to</label>
            <input
              id="age-gate-decline"
              className="glass-input"
              value={settings.age_gate_decline_url || ''}
              onChange={(e) => handleChange('age_gate_decline_url', e.target.value)}
              placeholder="https://example.com (blank shows a “sorry” screen instead)"
            />
          </div>

          <div style={{ marginTop: 'var(--sp-4)' }}>
            <SwitchRow
              id="age-gate-dob"
              icon={CalendarDays}
              title="Ask for a date of birth"
              hint="Instead of a yes/no button, the visitor enters their date of birth and it is checked against the minimum age."
              checked={settings.age_gate_require_dob === 'true'}
              onChange={(v) => handleChange('age_gate_require_dob', v ? 'true' : 'false')}
            />
          </div>

          <div style={{ marginTop: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="glass-btn glass-btn-sm"
              onClick={() => {
                updateTheme(AGE_GATE_KEYS.reduce((acc, k) => ({ ...acc, [k]: settings[k] }), {}));
                setPreviewAgeGate(true);
              }}
            >
              <MousePointerClick size={14} /> Preview gateway
            </button>
            <small style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
              Shows the real gateway with your current wording. Nothing is recorded.
            </small>
          </div>

          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '1rem 0 0', lineHeight: 1.55 }}>
            This is a notice, not an access control: it runs in the visitor’s browser and can
            be bypassed by anyone who wants to. Your real access rules are the login and the
            invite system.
          </p>
        </SwitchRow>
      </SettingsSection>
    ),
    payments: (
      /* Payment methods */
      <SettingsSection
        id="payments"
        title="Payment methods"
        icon={Server}
        lede={(
          <>
            Bitcoin, Litecoin and Monero are configured on the <strong>Nodes</strong> page — address, port,
            RPC credentials, wallet, Tor routing and whether each coin is offered at checkout — so node
            access can be delegated without handing over the rest of the settings.
          </>
        )}
      >
        <Link to="/admin/nodes" className="glass-btn glass-btn-sm" style={{ fontSize: 'var(--fs-sm)' }}>
          <Server size={14} /> Open Nodes
        </Link>

        {/* Out-of-band methods. Unlike the coins these are not node-backed, so
            they live here — but each still needs a recipient pool configured or
            checkout has nowhere to send the customer. */}
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <SwitchRow
            id="cash-in-mail-enabled"
            icon={Mail}
            title="Cash in Mail"
            hint="Offers cash by post at checkout. Each order is assigned an address from the rotating pool."
            checked={settings.cash_in_mail_enabled === 'true'}
            onChange={(v) => handleChange('cash_in_mail_enabled', v ? 'true' : 'false')}
          >
            <Link to="/admin/cash-mail" className="glass-btn glass-btn-sm" style={{ fontSize: 'var(--fs-sm)' }}>
              <Mail size={13} /> Manage addresses
            </Link>
          </SwitchRow>

          <SwitchRow
            id="zelle-enabled"
            icon={Banknote}
            title="Zelle"
            hint="Offers Zelle at checkout. Each order gets a reference code and a recipient from the rotating pool, and payments are confirmed manually."
            checked={settings.zelle_enabled === 'true'}
            onChange={(v) => handleChange('zelle_enabled', v ? 'true' : 'false')}
          >
            <Link to="/admin/zelle" className="glass-btn glass-btn-sm" style={{ fontSize: 'var(--fs-sm)' }}>
              <Banknote size={13} /> Manage accounts
            </Link>
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning)', display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-15)', margin: '0.6rem 0 0', lineHeight: 1.55 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 'var(--sp-05)' }} />
              Zelle recipients are real bank identities. Add at least one account with receive
              limits before enabling, or checkout will have no recipient to offer.
            </p>
          </SwitchRow>

          {/* The demo rail. Sits with the manual methods because, like them, it
              is not node-backed — but it is the only switch on this page that
              can hand out goods for nothing, so it is toned as a warning and
              says so in plain words rather than in a hint nobody reads.

              `demo_enabled` is only half the switch: services/botOrders.js also
              requires ALLOW_DEMO_PAYMENTS_IN_PRODUCTION when NODE_ENV is
              production, so a database restored from an evaluation box onto a
              real store arrives inert. That is why the copy says "in this
              environment" — flipping this on is not, by itself, enough to make
              the rail live everywhere the row travels. */}
          <SwitchRow
            id="demo-enabled"
            icon={FlaskConical}
            tone="warn"
            title="Demo payments (no money moves)"
            hint="Adds a test rail to checkout that mints a fake DEMO- address and marks the order paid on a timer, so the store can be walked through end to end without a coin node. Off on every install."
            checked={settings.demo_enabled === 'true'}
            onChange={(v) => handleChange('demo_enabled', v ? 'true' : 'false')}
          >
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning)', display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-15)', margin: '0 0 0.6rem', lineHeight: 1.55 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 'var(--sp-05)' }} />
              While this is on, anyone who picks it at checkout gets a real order marked paid,
              real stock decremented and your staff notified, having sent nothing. Turn it off
              before taking the store live.
            </p>
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="demo-confirm-seconds" style={{ fontSize: 'var(--fs-sm)' }}>
                Time spent &ldquo;confirming&rdquo;
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <input
                  id="demo-confirm-seconds"
                  className="glass-input"
                  type="number"
                  min="1"
                  max="3600"
                  step="1"
                  style={{ maxWidth: '7rem' }}
                  value={settings.demo_confirm_seconds ?? '20'}
                  onChange={(e) => handleChange('demo_confirm_seconds', e.target.value)}
                  // Blank is not "instant", it is a value the server clamps back
                  // to its own default — so the field says what will actually
                  // happen rather than leaving an empty box that means 20.
                  onBlur={(e) => { if (e.target.value.trim() === '') handleChange('demo_confirm_seconds', '20'); }}
                />
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>seconds</span>
              </div>
              <small>Long enough to show the pending → paid transition a real rail has; zero would settle before the buyer saw the payment screen.</small>
            </div>
          </SwitchRow>
        </div>

        {/* Both switches above are store-wide. These decide who gets offered
            the method once it is on — a new account starts with whatever is set
            here, and staff can override either flag per customer under Users. */}
        <div style={{ marginTop: 'var(--sp-6)', paddingTop: 'var(--sp-5)', borderTop: '1px solid var(--border)' }}>
          <h4 className="settings-subhead">
            <UserPlus size={15} /> New account defaults
          </h4>
          <p className="admin-hint" style={{ marginTop: 'calc(var(--sp-15) * -1)' }}>
            Both methods hand the buyer a real identity — a posting address or a bank account —
            so both are granted per account. Leave these off to vet customers before offering
            either; existing accounts are not changed by these switches.
          </p>

          <SwitchRow
            id="default-cash-in-mail"
            icon={Mail}
            title="New accounts get Cash in Mail"
            hint="A newly registered customer can pay by post straight away, without staff enabling it first."
            checked={settings.default_cash_in_mail_enabled === 'true'}
            onChange={(v) => handleChange('default_cash_in_mail_enabled', v ? 'true' : 'false')}
          />

          <SwitchRow
            id="default-zelle"
            icon={Banknote}
            title="New accounts get Zelle"
            hint="A newly registered customer is offered Zelle straight away. Leave off unless you are comfortable handing bank details to unvetted accounts."
            checked={settings.default_zelle_enabled === 'true'}
            onChange={(v) => handleChange('default_zelle_enabled', v ? 'true' : 'false')}
          />
        </div>

        {/* Every clock and cap below already governs real money and real stock —
            the sweeper in services/paymentChecker.js and the recipient pool read
            them on every run — but none of them had a field anywhere in this
            page, so the only way to change one was a direct UPDATE against
            store_settings. `manual_payment_expiry_hours` in particular is now
            the only thing standing between a bank transfer that takes a long
            weekend and an order cancelled out from under the buyer. */}
        <div style={{ marginTop: 'var(--sp-6)', paddingTop: 'var(--sp-5)', borderTop: '1px solid var(--border)' }}>
          <h4 className="settings-subhead">
            <Clock size={15} /> Payment timing &amp; limits
          </h4>
          <p className="admin-hint" style={{ marginTop: 'calc(var(--sp-15) * -1)' }}>
            How long the store waits for money to arrive, how long an unpaid order keeps a
            recipient reserved, and how much of the recipient pool one account may be shown.
            Cancelling an order returns its stock, its coupon use and any store credit it spent.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 'var(--sp-4)' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="auto-cancel-hours">Cancel unpaid crypto orders after (hours)</label>
              <input
                id="auto-cancel-hours"
                className="glass-input"
                type="number"
                min="1"
                step="1"
                value={settings.auto_cancel_hours ?? '48'}
                onChange={(e) => handleChange('auto_cancel_hours', e.target.value)}
              />
              <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
                Also the payment window quoted to the buyer when a BTC, LTC or XMR address is
                issued. An order with coins already received is never auto-cancelled — it is
                flagged for a human instead.
              </small>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="manual-expiry-hours">Cancel unpaid Zelle / cash orders after (hours)</label>
              <input
                id="manual-expiry-hours"
                className="glass-input"
                type="number"
                min="1"
                step="1"
                value={settings.manual_payment_expiry_hours ?? '72'}
                onChange={(e) => handleChange('manual_payment_expiry_hours', e.target.value)}
              />
              <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
                Sized for a bank transfer or an envelope, not a chain confirmation — the default
                of 72 covers a weekend where 24 does not. Set it too low and a slow but honest
                postal payment arrives to a cancelled order.
              </small>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="zelle-hold-hours">Zelle recipient hold (hours)</label>
              <input
                id="zelle-hold-hours"
                className="glass-input"
                type="number"
                min="1"
                step="1"
                value={settings.zelle_hold_hours ?? '24'}
                onChange={(e) => handleChange('zelle_hold_hours', e.target.value)}
              />
              <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
                How long an unpaid order reserves headroom against a Zelle account&apos;s receive
                limit. Shorter than the cancel window on purpose: it frees capacity for other
                buyers without giving up on this order.
              </small>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="cash-mail-hold-hours">Cash in Mail recipient hold (hours)</label>
              <input
                id="cash-mail-hold-hours"
                className="glass-input"
                type="number"
                min="1"
                step="1"
                value={settings.cash_mail_hold_hours ?? '24'}
                onChange={(e) => handleChange('cash_mail_hold_hours', e.target.value)}
              />
              <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
                The same reservation for posting addresses. Releasing a hold does not cancel the
                order; it only returns the address&apos;s capacity to the pool.
              </small>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="recipient-reveal-cap">Recipients shown per account per day</label>
              <input
                id="recipient-reveal-cap"
                className="glass-input"
                type="number"
                min="0"
                step="1"
                value={settings.recipient_reveal_limit_per_day ?? '3'}
                onChange={(e) => handleChange('recipient_reveal_limit_per_day', e.target.value)}
                // An empty box must not read as "no cap". Blanking the field
                // posts '', which the server used to parse to NaN and treat as
                // disabled — the pool became walkable while this page said the
                // settings had saved. Restoring the default on blur means the
                // only way to switch the cap off is to type a deliberate 0.
                onBlur={(e) => {
                  if (e.target.value.trim() === '') handleChange('recipient_reveal_limit_per_day', '3');
                }}
              />
              <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
                Anti-enumeration: once an account has seen this many distinct bank accounts or
                addresses in a rolling 24 hours, further orders reuse ones it has already been
                shown. 0 disables the cap and lets one account map your whole pool.
              </small>
            </div>
          </div>
        </div>
      </SettingsSection>
    ),
    features: (
      /* ── Orders ─────────────────────────────────────────────────────
          Was "Store Features", which by the end held the order lifecycle,
          the packing bench, two stock controls and a pricing mode in one
          card — DESIGN §7's "group by task, not by table schema" failing in
          the direction a settings page always fails: whatever had no obvious
          home went here.

          The id stays `features`. It is what the admin nav's search resolves
          against and what adminSearch.test.mjs asserts still exists; renaming
          it would break a search result silently. The TITLE is what was
          wrong, not the address. */
      <SettingsSection
        id="features"
        title="Orders"
        icon={ClipboardList}
        lede="What happens to an order between the money arriving and the parcel leaving."
      >
        <div className="form-group">
          <label id="orders-auto-accept" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.orders_auto_accept === 'true'}
              onChange={e => handleChange('orders_auto_accept', e.target.checked ? 'true' : 'false')}
            />
            Accept paid orders automatically
          </label>
          <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
            Off by default. With this on, an order moves straight from paid to accepted the moment
            its payment is confirmed — on every rail, including coins confirmed by the poller,
            Zelle and cash confirmed by staff, and orders a buyer settled entirely with store
            credit. The order lands on the Ship desk without anyone pressing Accept, and the buyer
            is told, exactly as if a staff member had done it.
            {' '}
            <strong style={{ color: 'var(--text)' }}>Nothing about how payments are verified
            changes.</strong>{' '}
            A coin order still has to clear its on-chain check, and a short or unverified payment
            is still refused — this only decides whether a confirmed order waits for a second
            pair of eyes before it can be packed. Leave it off if you want that look.
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="auto-finalize-days">Auto-Finalize Orders After (days)</label>
          <input
            id="auto-finalize-days"
            className="glass-input"
            type="number"
            min="0"
            step="1"
            value={settings.auto_finalize_days ?? '0'}
            onChange={e => handleChange('auto_finalize_days', e.target.value)}
            placeholder="0 = disabled"
          />
          <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
            Shipped orders are automatically marked as delivered after this many days if no dispute is open. Set to 0 to disable.
          </small>
        </div>
      </SettingsSection>
    ),
    fulfilment: (
      /* ── Fulfilment ─────────────────────────────────────────────────
          The packing bench and the dispatch desk. These five were scattered
          through the old card between an order setting and a stock one; they
          are one job, done by one person, at one screen. */
      <SettingsSection
        id="fulfilment"
        title="Fulfilment"
        icon={Boxes}
        lede="Whether an order has a destination at all, and how it is packed and handed over. Checkout, the Ship desk and the packing bench read these."
      >
        <div className="form-group">
          <label id="require-shipping-address" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.require_shipping_address !== 'false'}
              onChange={e => handleChange('require_shipping_address', e.target.checked ? 'true' : 'false')}
            />
            Ask buyers for a delivery address
          </label>
          <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
            On, an order cannot be placed without one — on the website and on both bots, which walk
            the buyer through the same fields one message at a time. Turning it off is the setting
            for a shop selling something that does not travel: the address form is not drawn, the
            bots skip straight to the coupon step, nothing is asked and nothing is stored, and
            orders arrive with no destination for the Ship desk to send them to. Flipping it never
            rewrites past orders — they keep the addresses they already carry — only what the next
            ones are asked for.
          </small>
        </div>

        <div className="form-group">
          <label>Packing Claim (minutes)</label>
          <input
            id="pack-claim-minutes"
            className="glass-input"
            type="number"
            min="1"
            max="1440"
            step="1"
            value={settings.pack_claim_minutes ?? '20'}
            onChange={e => handleChange('pack_claim_minutes', e.target.value)}
          />
          <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
            How long one packer holds an order on the packing screen before an idle claim expires
            and another packer may take it over. Recording picks renews the claim, so this only
            decides how long an abandoned box stays locked.
          </small>
        </div>

        <div className="form-group">
          <label id="pack-require-tracking" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.pack_require_tracking === 'true'}
              onChange={e => handleChange('pack_require_tracking', e.target.checked ? 'true' : 'false')}
            />
            Require a tracking number on every box
          </label>
          <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
            Packers always record what boxes an order ships in. With this on, each box also needs a
            tracking number before it can ship from the Ship desk, and the order only becomes
            &quot;shipped&quot; when its last box goes. Leave it off for mail with no tracking —
            boxes then ship freely, singly or with the order. Flipping it never rewrites past
            orders, only how the next ones move.
          </small>
        </div>

        <div className="form-group">
          <label id="pack-seal-on-ship" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.pack_seal_on_ship !== 'false'}
              onChange={e => handleChange('pack_seal_on_ship', e.target.checked ? 'true' : 'false')}
            />
            Seal a box automatically when it ships
          </label>
          <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
            A sealed box stops accepting changes to what is inside it; weight and notes stay
            editable. On, because a parcel that has left the building cannot truthfully have its
            contents edited. Turn it off only if you correct records after the fact — a shipped
            box is frozen either way, so this really only affects the moment the seal lands.
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="ship-carriers">Carriers</label>
          <input
            id="ship-carriers"
            className="glass-input"
            type="text"
            value={carriersText}
            onChange={e => setCarriersText(e.target.value)}
            onBlur={() => handleChange('ship_carriers', JSON.stringify(
              carriersText.split(',').map(c => c.trim()).filter(Boolean),
            ))}
            placeholder="Royal Mail, USPS, DPD"
          />
          <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
            Comma-separated. Offered as suggestions on the Ship desk&apos;s carrier field so
            &quot;USPS&quot; and &quot;usps&quot; stop being two carriers in the manifest. It is a
            spelling aid, never a restriction — a dispatcher can always type one that is not on the
            list, which matters when a parcel physically left and the record has to say so. Leave
            it empty to keep the field plain free text.
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="box-presets">Box presets</label>
          <input
            id="box-presets"
            className="glass-input"
            type="text"
            value={presetsText}
            onChange={e => setPresetsText(e.target.value)}
            onBlur={() => handleChange('pack_box_presets', JSON.stringify(
              presetsText.split(',').map((chunk) => {
                // "Small mailer:45" — name, optional empty weight in grams.
                const [name, tare] = chunk.split(':');
                const clean = (name || '').trim();
                if (!clean) return null;
                const g = parseInt((tare || '').trim(), 10);
                return Number.isInteger(g) && g >= 0 ? { name: clean, tare_grams: g } : { name: clean };
              }).filter(Boolean),
            ))}
            placeholder="Letter mailer:15, Small mailer:45, Medium box:180"
          />
          <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
            The cartons you actually stock, as <code>Name:grams</code> — the number is the weight of
            the EMPTY box, prefilled at the bench so the packer weighs the full parcel and the
            difference is the goods. The name is kept on each box, so the manifest can tell you how
            many of each carton went out and what to reorder. Omit the number if you do not weigh.
          </small>
        </div>

        <div className="form-group" data-search-target="staging-places">
          <label htmlFor="staging-places">Staging places</label>
          <input
            id="staging-places"
            className="glass-input"
            type="text"
            value={placesText}
            onChange={e => setPlacesText(e.target.value)}
            onBlur={() => handleChange('pack_staging_places', JSON.stringify(
              placesText.split(',').map((name) => name.trim()).filter(Boolean),
            ))}
            placeholder="Bay 1, Bay 2, Trolley A, By the door"
          />
          <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
            Where a packer puts a carton down once it is taped shut. The bench asks at the seal and
            the Ship desk shows the answer, so a dispatcher reads <em>where to walk</em> instead of
            hunting for three identical boxes. Leave it empty and the bench never asks — which is
            the right answer for one bench and one table.
          </small>
        </div>
      </SettingsSection>
    ),
    'package-tracking': (
      /* ── Package tracking ── the carrier-lookup worker and its
          credentials. Its own component: the card is the size of a page and
          reads the worker's queue, and this file is long enough. */
      <TrackingSettings
        settings={settings}
        handleChange={handleChange}
        SettingsSection={SettingsSection}
        SwitchRow={SwitchRow}
      />
    ),
    'address-lookup': (
      /* ── Address lookup ── proxied geocoding for the checkout's address
          builder. Off by default; see server/config/geocodeKeys.js for the
          four reasons it is never called from the browser. */
      <SettingsSection
        id="address-lookup"
        title="Address lookup"
        icon={Search}
        lede="A search box in the checkout's address form that fills the fields from a geocoder. Every query goes through this server, never from the buyer's browser; offered only in the address form, never beside the encrypt-it-yourself option; and the form says where the query goes."
      >
        <div className="aset-fields">
          <div className="form-group">
            <label htmlFor="geocode-provider">Provider</label>
            <select id="geocode-provider" className="glass-input" value={settings.geocode_provider || 'off'} onChange={(e) => handleChange('geocode_provider', e.target.value)}>
              <option value="off">Off — no lookup</option>
              <option value="nominatim">Nominatim (OpenStreetMap) — submit only, 1 request/s store-wide</option>
              <option value="photon">Photon (Komoot) — as you type, self-hostable</option>
              <option value="google">Google Places — as you type, needs an API key</option>
            </select>
            <p className="setting-row-hint">Nominatim's policy forbids search-as-you-type, so its field waits for Enter; the mode is decided here, not in the page. Photon can be pointed at your own server below.</p>
          </div>
          <div className="form-group">
            <label htmlFor="geocode-base-url">Base URL override</label>
            <input id="geocode-base-url" className="glass-input" value={settings.geocode_base_url || ''} onChange={(e) => handleChange('geocode_base_url', e.target.value)} placeholder="https://photon.your-server.example" />
            <p className="setting-row-hint">Leave blank for the provider's public endpoint. Private addresses are refused when dialled — the same guard the import scraper has.</p>
          </div>
          <div className="form-group">
            <label htmlFor="geocode-api-key">API key {settings.geocode_api_key_configured === 'true' && <span className="field-opt">(set — leave blank to keep)</span>}</label>
            <input id="geocode-api-key" className="glass-input" type="password" value={settings.geocode_api_key || ''} onChange={(e) => handleChange('geocode_api_key', e.target.value)} autoComplete="new-password" placeholder={settings.geocode_api_key_configured === 'true' ? '••••••••' : 'Only Google needs one'} />
          </div>
          <div className="form-group">
            <label htmlFor="geocode-countries">Bias to countries</label>
            <input id="geocode-countries" className="glass-input" value={settings.geocode_countries || ''} onChange={(e) => handleChange('geocode_countries', e.target.value)} placeholder="us,ca" maxLength={40} />
            <p className="setting-row-hint">Two-letter codes, comma separated. Optional.</p>
          </div>
          <div className="form-group">
            <label htmlFor="geocode-route">Lookups leave via</label>
            <select id="geocode-route" className="glass-input" value={routeValue(settings, { key: 'geocode_route' })} onChange={(e) => handleChange('geocode_route', e.target.value)}>
              {ROUTE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <p className="setting-row-hint">Through Tor or the proxy pool the provider sees an exit or a proxy, not this server. Slower; the field says so.</p>
          </div>
        </div>
      </SettingsSection>
    ),
    pricing: (
      /* ── Pricing ────────────────────────────────────────────────────
          One control, and it earns its own card rather than sitting under a
          heading that says nothing about it: rounding decides what a sub-user
          is charged, which is money, and money settings should not be found
          by accident while looking for a packing claim. */
      <SettingsSection
        id="pricing"
        title="Pricing"
        icon={Wallet}
        lede="How prices are presented to sub-user accounts, and whether the store keeps a credit balance at all."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', marginTop: 'var(--sp-2)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', cursor: 'pointer' }}>
            <input
              id="store-credit-enabled"
              type="checkbox"
              checked={settings.store_credit_enabled !== 'false'}
              onChange={e => handleChange('store_credit_enabled', e.target.checked ? 'true' : 'false')}
            />
            <span>Enable store credit system (sub-user rewards and coupon credit)</span>
          </label>
        </div>

        {/* Per-rail fees and discounts (server/config/railKeys). Applied by
            the pricing engine after tier and sale prices and before the
            coupon, on both the web and the bot checkout, and shown as its
            own line — the catalogue keeps showing base prices. */}
        <RailPricingEditor
          value={settings.payment_rail_adjustments}
          onChange={(v) => handleChange('payment_rail_adjustments', v)}
        />

        <div className="form-group">
          <label htmlFor="price-round-mode">Sub-User Price Rounding Mode</label>
          <select
            id="price-round-mode"
            className="glass-input"
            value={settings.price_round_mode ?? 'none'}
            onChange={e => handleChange('price_round_mode', e.target.value)}
          >
            <option value="none">No rounding (standard 2 decimal places)</option>
            <option value="99">Round up to .99 (e.g. $10.99)</option>
            <option value="50">Round up to .50 (e.g. $10.50)</option>
            <option value="00">Round up to whole dollar (e.g. $11.00)</option>
          </select>
        </div>

        {/* The exchange-rate feed's route. Moved here from the Tor proxy card:
            it saves under settings.payments like everything else on this
            card, while the Tor host and port save under settings.security —
            so over there it was a field a payments manager could see and not
            save, on a card no single grant could save whole. Every other
            consumer's route sits on that consumer's own card, and the feed's
            consumer is pricing. */}
        <div className="form-group">
          <label htmlFor="price-route">Price feed leaves via</label>
          <select
            id="price-route"
            className="glass-input"
            value={routeValue(settings, { key: 'price_route' })}
            onChange={(e) => handleChange('price_route', e.target.value)}
          >
            {ROUTE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: 'var(--sp-15)' }}>
            The exchange-rate lookup that turns a listed price into coin at checkout. Direct is
            fastest; Tor or the pool if this server&apos;s own address should not be the one asking.
          </small>
        </div>
      </SettingsSection>
    ),
    'stock-alerts': (
      <SettingsSection
        id="stock-alerts"
        title="Stock alerts"
        icon={PackageSearch}
        className="sa-card"
        tight
      >
        <div className="form-group">
          <label htmlFor="low-stock-threshold">Low Stock Alert Threshold</label>
          <input
            id="low-stock-threshold"
            className="glass-input"
            type="number"
            min="0"
            step="1"
            value={settings.low_stock_threshold ?? '5'}
            onChange={e => handleChange('low_stock_threshold', e.target.value)}
          />
          <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
            Shows the low-stock alert on the dashboard for variants at or below this quantity, and
            acts as the fallback in Stock alerts below for products with too few recent sales to
            have a believable velocity.
          </small>
        </div>

        <div className="form-group">
          <label id="stock-count-approval" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.stock_count_require_approval === 'true'}
              onChange={e => handleChange('stock_count_require_approval', e.target.checked ? 'true' : 'false')}
            />
            Every shelf count needs a second pair of eyes
          </label>
          <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-1)' }}>
            Counts are always recorded. What this decides is whether they also MOVE stock. Off, a
            counter holding &quot;Adjust stock&quot; applies their own count immediately — they can
            already type any number into the product editor, so making them queue it would just
            push them back there, where no count is recorded at all. Anyone without that grant is
            queued for approval either way. Turn it on if you want four eyes on every adjustment,
            accepting that counts will sit waiting.
          </small>
        </div>

        <p className="sa-lede">
          A flat quantity treats a line selling forty a week the same as one selling one a month —
          too late for the first, permanent noise for the second. These alerts measure{' '}
          <strong>days of cover</strong> instead: stock divided by how fast it is actually selling.
        </p>

        <SwitchRow
          id="stock-alert-enabled"
          title="Alert staff when stock runs low"
          hint="One batched message to every linked staff bot when a product crosses the threshold, and again if it reaches zero. Off by default — it puts product names and quantities on your bot channels on a schedule, with no human in the loop."
          icon={Bell}
          checked={stockAlertsOn}
          onChange={(on) => handleChange('stock_alert_enabled', on ? 'true' : 'false')}
        />

        <div className={`sa-fields${stockAlertsOn ? ' is-live' : ''}`}>
          <div className="sa-field">
            <label htmlFor="sa-window"><Boxes size={14} /> Sales window</label>
            <div className="sa-input-row">
              <input
                id="sa-window"
                className="glass-input sa-input"
                type="number"
                min="1"
                max="365"
                step="1"
                value={stockWindowDays}
                onChange={(e) => handleChange('stock_alert_window_days', e.target.value)}
                // A blank window is not "no window", it is a division by zero.
                // Restoring the default on blur means the only way to change it
                // is to type a number.
                onBlur={(e) => { if (e.target.value.trim() === '') handleChange('stock_alert_window_days', '14'); }}
              />
              <span className="sa-unit">days</span>
            </div>
            <small>How far back to measure sales. Longer smooths a quiet week; shorter reacts faster to a product taking off.</small>
          </div>

          <div className="sa-field">
            <label htmlFor="sa-cover"><Gauge size={14} /> Alert below</label>
            <div className="sa-input-row">
              <input
                id="sa-cover"
                className="glass-input sa-input"
                type="number"
                min="0"
                max="365"
                step="1"
                value={stockCoverDays}
                onChange={(e) => handleChange('stock_alert_days_of_cover', e.target.value)}
                onBlur={(e) => { if (e.target.value.trim() === '') handleChange('stock_alert_days_of_cover', '7'); }}
              />
              <span className="sa-unit">days of cover</span>
            </div>
            <small>Roughly: how long restocking takes you. Set it so an alert arrives while there is still time to reorder.</small>
          </div>

          <div className="sa-field">
            <label htmlFor="sa-scan"><Timer size={14} /> Scan every</label>
            <div className="sa-input-row">
              <input
                id="sa-scan"
                className="glass-input sa-input"
                type="number"
                min="1"
                max="1440"
                step="1"
                value={stockScanMinutes}
                onChange={(e) => handleChange('stock_alert_scan_minutes', e.target.value)}
                onBlur={(e) => { if (e.target.value.trim() === '') handleChange('stock_alert_scan_minutes', '30'); }}
              />
              <span className="sa-unit">minutes</span>
            </div>
            <small>Takes effect on the next scan — no restart. A product only alerts when it crosses the line, never on every scan.</small>
          </div>
        </div>

        {/* Live preview */}
        {/* `is-busy` only once there is something to dim. On the very first
            load the skeleton is already saying "not ready"; dimming it too
            just makes the placeholder harder to see. */}
        <div
          className={`sa-preview${stockPreviewBusy && stockPreviewStatus === 'ready' ? ' is-busy' : ''}`}
          aria-live="polite"
        >
          <div className="sa-preview-head">
            <span className="sa-preview-title">
              <span className={`sa-dot${stockAlertsOn ? ' is-live' : ''}`} aria-hidden="true" />
              Right now, at these thresholds
            </span>
            {stockPreviewBusy && <span className="sa-recalc">recalculating…</span>}
          </div>

          {stockPreviewStatus === 'loading' && (
            // A shaped placeholder rather than a spinner: the panel keeps the
            // height it is about to have, so the fields above it do not jump
            // when the first answer lands.
            <div className="sa-skeleton" aria-hidden="true">
              <span className="sa-skeleton-figure" />
              <span className="sa-skeleton-line" />
              <span className="sa-skeleton-line sa-skeleton-line-short" />
            </div>
          )}
          {stockPreviewStatus === 'denied' && (
            <p className="sa-note">
              The preview needs the <code>products.stock</code> permission. The thresholds above still save.
            </p>
          )}
          {stockPreviewStatus === 'error' && (
            <p className="sa-note sa-note-warn">
              <AlertTriangle size={14} /> Could not read the catalog just now.
            </p>
          )}

          {stockPreviewStatus === 'ready' && stockPreview && (
            <>
              <div className="sa-figures">
                <div className="sa-figure">
                  {/* Keyed on the value so React remounts the node when the
                      count changes, which restarts the CSS entrance animation.
                      Without it the number swaps silently and a threshold
                      change three fields away looks like it did nothing. */}
                  <span className="sa-figure-value" key={stockPreview.alerting}>{stockPreview.alerting}</span>
                  <span className="sa-figure-label">
                    {stockPreview.alerting === 1 ? 'variant would alert' : 'variants would alert'}
                    <em> of {stockPreview.scanned}</em>
                  </span>
                </div>
                <div className="sa-chips">
                  <span className="sa-chip sa-chip-danger">
                    <TrendingDown size={13} /> {stockPreview.out_of_stock} out of stock
                  </span>
                  <span className="sa-chip sa-chip-warn">
                    <Gauge size={13} /> {stockPreview.running_low} running low
                  </span>
                  <span className="sa-chip">
                    {stockPreview.by_velocity} by velocity · {stockPreview.by_floor} by the flat floor
                  </span>
                </div>
              </div>

              {stockPreview.sample?.length > 0 ? (
                <ul className="sa-list">
                  {stockPreview.sample.map((item) => (
                    <li key={item.variant_id} className={`sa-row sa-row-${item.state}`}>
                      <span className="sa-row-name" title={`${item.group_name} — ${item.variant_name}`}>
                        <strong>{item.group_name}</strong>
                        <span className="sa-row-variant">{item.variant_name}</span>
                      </span>
                      <span className="sa-row-cover">{coverLabel(item)}</span>
                      <span className="sa-row-qty">{item.quantity} left</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sa-note sa-note-ok">Nothing is below the line. Every active variant has cover to spare.</p>
              )}

              {stockPreview.alerting > (stockPreview.sample?.length || 0) && (
                <p className="sa-more">
                  Showing the {stockPreview.sample.length} with the least cover.
                  Alerts are batched, so this is one message, not {stockPreview.alerting}.
                </p>
              )}

              {!stockAlertsOn && (
                <p className="sa-note">None of this is sent while the switch above is off.</p>
              )}
            </>
          )}
        </div>
      </SettingsSection>
    ),
    'ops-alerts': (
      /* ── Operations alerts ──────────────────────────────────────────────
       *
       * Seventeen settings that worked perfectly and could not be reached.
       * `ops_briefing_enabled`, `ops_alerts_enabled`, `ops_briefing_hour` and
       * the fourteen thresholds were all read by the server, all gated by
       * `config/permissions.js`, and none of them appeared on any screen — the
       * console has no raw key editor, so the only way to set one was a
       * hand-written API call.
       *
       * The hour is the sharpest of them. `services/ai/opsBriefing.js` argues
       * that a daily staff message IS a pattern — "same time every day, same
       * recipients — and that pattern is the operator's to choose, not a
       * default they discover" — and the knob that chooses it was the one they
       * could not reach.
       *
       * The thresholds render from the server's own list, so a fifteenth added
       * to `opsBriefing.THRESHOLDS` appears here with no client change.
       */
      <SettingsSection
        id="ops-alerts"
        title="Operations alerts"
        icon={Siren}
        className="ops-card"
        tight
      >
        <p className="sa-lede">
          The shop can message your staff on its own: a plain-language note once a day, and a
          message the moment a queue crosses a number you set. Both are <strong>off</strong> until
          you turn them on, and they are separate switches — wanting a morning summary is not the
          same as wanting to be interrupted.
        </p>

        <SwitchRow
          id="ops-briefing-enabled"
          title="Send a daily briefing"
          hint="One message a day to every staff channel, in prose, saying what needs attention. Written by the assistant from counts the shop computed itself; if the model is unreachable it sends the counts instead."
          icon={Bell}
          checked={settings.ops_briefing_enabled === 'true'}
          onChange={(on) => handleChange('ops_briefing_enabled', on ? 'true' : 'false')}
        />

        <div className={`sa-fields${settings.ops_briefing_enabled === 'true' ? ' is-live' : ''}`}>
          <div className="sa-field">
            <label htmlFor="ops-hour"><Clock3 size={14} /> Send it at</label>
            <div className="sa-input-row">
              <input
                id="ops-hour"
                className="glass-input sa-input"
                type="number"
                min="0"
                max="23"
                step="1"
                value={settings.ops_briefing_hour ?? '8'}
                onChange={(e) => handleChange('ops_briefing_hour', e.target.value)}
                onBlur={(e) => { if (e.target.value.trim() === '') handleChange('ops_briefing_hour', '8'); }}
              />
              <span className="sa-unit">:00, server time</span>
            </div>
            {/* The one piece of advice on this card that is about safety rather
                than about usefulness, and it is why the control exists. */}
            <small>
              A message at the same hour every day, to the same people, is a pattern. On a
              Tor-fronted store that pattern is yours to choose — pick an hour that suits how you
              work, not the one that suits an observer.
            </small>
          </div>
        </div>

        <SwitchRow
          id="ops-alerts-enabled"
          title="Alert staff when a queue gets long"
          hint="A message as soon as one of the counts below goes past your number, rather than waiting for tomorrow's briefing. No model is involved: a threshold that fires is a fact, and one that fired because a model felt uneasy is not something you could tune or switch off with confidence."
          icon={Siren}
          checked={settings.ops_alerts_enabled === 'true'}
          onChange={(on) => handleChange('ops_alerts_enabled', on ? 'true' : 'false')}
        />

        {opsThresholds.length > 0 && (
          <div className={`ops-thresholds${settings.ops_alerts_enabled === 'true' ? ' is-live' : ''}`}>
            {opsThresholds.map((t) => (
              <div key={t.key} className="ops-threshold">
                <label htmlFor={`f-${t.key}`}>{t.label}</label>
                <div className="sa-input-row">
                  <span className="ops-threshold-more">more than</span>
                  <input
                    id={`f-${t.key}`}
                    className="glass-input sa-input"
                    type="number"
                    min="0"
                    step="1"
                    placeholder={String(t.fallback)}
                    value={settings[t.key] ?? String(t.fallback)}
                    onChange={(e) => handleChange(t.key, e.target.value)}
                    onBlur={(e) => { if (e.target.value.trim() === '') handleChange(t.key, String(t.fallback)); }}
                  />
                </div>
              </div>
            ))}
            {/* Zero is not "alert on everything", and an operator who assumed
                it was would switch a threshold off while believing they had
                made it maximally sensitive. */}
            <p className="sa-note">
              Set one to <strong>0</strong> to switch that alert off entirely — it does not mean
              &quot;alert at the first one&quot;. A switched-off threshold stays off across a
              deploy rather than falling back to the shipped number.
            </p>
          </div>
        )}

        {settings.ops_alerts_enabled !== 'true' && (
          <p className="sa-note">Nothing above is sent while the switch is off.</p>
        )}
      </SettingsSection>
    ),
    'outbound-proxies': (
      /* ── Outbound proxies ── the routes third-party traffic may leave by.
          Sits right after Tor proxy, which is the one-hop version of the same
          decision; the tracking card above points here. */
      <ProxyPoolSettings
        settings={settings}
        handleChange={handleChange}
        SettingsSection={SettingsSection}
      />
    ),
    mirrors: (
      /* ── Mirrors ──
          Where this store is genuinely reachable. Stored canonically as JSON
          (config/mirrorKeys), edited here as one host per line, signed with
          the store key and served at /mirrors.txt; the storefront footer
          compares the visitor's address against it. */
      <SettingsSection
        id="mirrors"
        title="Mirrors"
        icon={Globe}
        lede="Every address this store is reachable at — a clearnet domain, an onion, a backup domain. Published signed, so a visitor on any mirror can check the list came from you and that the address they are on is in it."
      >
        <MirrorsEditor
          value={settings.store_mirrors}
          note={settings.store_mirrors_note}
          policy={settings.clearnet_policy}
          onChange={(v) => handleChange('store_mirrors', v)}
          onNoteChange={(v) => handleChange('store_mirrors_note', v)}
          onPolicyChange={(v) => handleChange('clearnet_policy', v)}
        />
      </SettingsSection>
    ),
    footer: (
      /* ── Storefront footer ── */
      <SettingsSection
        id="footer"
        title="Footer"
        icon={PanelBottom}
        tight
      >
        <SwitchRow
          id="footer-enabled"
          title="Show a footer on the storefront"
          hint="A quiet bar at the bottom of every store page: the store's name, the links you pick below, and an optional line of text."
          icon={PanelBottom}
          checked={settings.footer_enabled === 'true'}
          onChange={(on) => handleChange('footer_enabled', on ? 'true' : 'false')}
        >
          {(() => {
            let picked = [];
            try {
              const parsed = JSON.parse(settings.footer_links || '[]');
              if (Array.isArray(parsed)) picked = parsed;
            } catch { /* bad blob renders as nothing picked */ }
            const toggleLink = (id, on) => {
              // Order preserved by roster position, so the footer reads in a
              // stable, sensible order however the boxes were clicked.
              const next = FOOTER_LINK_ROSTER
                .map((l) => l.id)
                .filter((lid) => (lid === id ? on : picked.includes(lid)));
              handleChange('footer_links', JSON.stringify(next));
            };
            return (
              <>
                {/* The picker is a grid of checkboxes with no single control
                    to point at, so it carries the search target itself — an
                    operator looking for "footer links" wants this block, not
                    one of the twelve boxes in it. */}
                <div
                  data-search-target="footer-links"
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(190px, 100%), 1fr))', gap: 'var(--sp-15) var(--sp-4)', marginBottom: 'var(--sp-4)' }}
                >
                  {FOOTER_LINK_ROSTER.map((l) => (
                    <label key={l.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-2)', cursor: 'pointer', fontSize: 'var(--fs-base)' }}>
                      <input
                        type="checkbox"
                        checked={picked.includes(l.id)}
                        onChange={(e) => toggleLink(l.id, e.target.checked)}
                        style={{ accentColor: 'var(--primary)', marginTop: 'var(--sp-1)' }}
                      />
                      <span>
                        {l.label}
                        {l.note && (
                          <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 'var(--fs-2xs)' }}>{l.note}</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="footer-text">Footer text (optional)</label>
                  <input
                    id="footer-text"
                    className="glass-input"
                    value={settings.footer_text || ''}
                    onChange={(e) => handleChange('footer_text', e.target.value)}
                    maxLength={200}
                    placeholder="e.g. All orders ship in plain packaging. Encrypt sensitive messages to our PGP key."
                  />
                </div>
              </>
            );
          })()}
        </SwitchRow>
      </SettingsSection>
    ),
    seo: (
      /* ── Search engines ──
          Whether this store wants to be found, and what it says when it is.
          Both switches ship off (server/config/seoKeys.js); the server writes
          the head, robots.txt and the sitemap from these (services/seo.js). */
      <SettingsSection
        id="seo"
        title="Search engines"
        icon={Radar}
        lede="Off, the store tells every crawler and archive to keep nothing. On, it publishes a sitemap, a description and structured data for what a signed-out visitor can see — never an account page, never the catalogue of a store that requires an account."
      >
        <SeoEditor settings={settings} handleChange={handleChange} />
      </SettingsSection>
    ),
    csv: (
      /* Order export / product import. Moved here from the Coupons page —
          the tools never had anything to do with coupons, only their routes
          do (see CsvTools.jsx for why the routes stayed put).

          Wrapped rather than converted: CsvTools renders its own card and is
          used elsewhere, so the marker goes on a plain container around it and
          the search still indexes everything the card renders. */
      <div
        data-settings-section="csv"
      >
        <CsvTools />
      </div>
    ),
  };

  const groupByTitle = new Map(settingGroups.map((g) => [g.title, g]));
  const cardFor = (id) => cards[id] || (groupByTitle.has(id) ? renderGroup(groupByTitle.get(id)) : null);
  // A group added to settingGroups.js and not yet filed in a chapter still
  // renders — under a chapter of its own at the end — rather than vanishing.
  // The adminSearch test fails by name until it is filed.
  const unplacedGroups = settingGroups.filter((g) => !PLACED_SECTIONS.has(g.title));

  return (
    /* DESIGN §1 and §5: the 860px centred column is gone. This is the longest
       page in the admin panel and it now carries a section rail, so the width
       is the two columns' and the breakpoint is a CONTAINER query — the admin
       shell already takes a sidebar's worth off the window, so a viewport
       query would fire the wide rules in a box too narrow for them. */
    <div className="admin-page">
      <PageHeader
        icon={SettingsIcon}
        title="Store settings"
        subtitle="Eight chapters, from the storefront to the network. Changes apply the moment you save."
      />

      {/* Heard, not discovered on save. The socket says which keys moved and
          who moved them — never their values, see chatService — so this is a
          prompt to re-read one card rather than a diff. Above the rail because
          it changes what everything below it means. */}
      {watch.stale.length > 0 && conflicts.length === 0 && (
        <div className="glass-card admin-panel-in scfl scfl-live" role="status">
          <p className="admin-hint">
            <AlertTriangle size={14} aria-hidden="true" />
            {' '}{watch.by ? `${watch.by} changed` : 'Somebody changed'}
            {' '}{watch.stale.length === 1 ? 'a setting' : `${watch.stale.length} settings`} on this
            page just now: {watch.stale.map((k) => <code key={k} className="scfl-key">{k}</code>)}.
            {' '}Saving will be refused for {watch.stale.length === 1 ? 'it' : 'those'} until you
            reload.
          </p>
          <div className="scfl-foot">
            <button type="button" className="glass-btn glass-btn-primary glass-btn-sm" onClick={() => { watch.clear(); load(); }}>
              <RefreshCw size={13} aria-hidden="true" /> Reload
            </button>
            <button type="button" className="glass-btn glass-btn-sm" onClick={watch.clear}>Dismiss</button>
          </div>
        </div>
      )}

      <SettingsConflict
        conflicts={conflicts}
        onTakeTheirs={takeTheirs}
        onKeepMine={keepMine}
        onReload={() => { setConflicts([]); load(); }}
        onDismiss={() => setConflicts([])}
      />

      <SettingsShell
        chapters={RAIL_CHAPTERS}
        dirtyCount={changedKeys.length}
        saving={saving}
        onSave={handleSave}
        onDiscard={discardChanges}
      >

      {/* The search that used to sit here now lives at the top of the admin
          nav (components/admin/AdminSearch). It moved because a settings search
          that only knew about this page could not find a rate limit, a node's
          RPC password or a VIP tier — an operator searched, found nothing, and
          reasonably concluded the store had no such setting.

          The cards below keep their `data-settings-section` attribute and their
          per-control ids: those are what the nav search navigates to, and what
          AdminLayout's resolver glows on arrival. Removing one silently breaks
          a search result, which is why client/test/adminSearch.test.mjs checks
          every target in the index still exists in this file. */}

      {/* Chapter by chapter, in the order config/settingsChapters.js decides.
          Each chapter is a heading, a one-line lede, and its cards; the rail
          on the left is built from the same list, so the two cannot disagree
          about what comes after what. */}
      {SETTINGS_CHAPTERS.map((chapter) => (
        <SettingsChapter key={chapter.id} chapter={chapter}>
          {chapter.sections.map((id) => <Fragment key={id}>{cardFor(id)}</Fragment>)}
        </SettingsChapter>
      ))}
      {unplacedGroups.length > 0 && (
        <SettingsChapter chapter={UNFILED_CHAPTER}>
          {unplacedGroups.map((g) => <Fragment key={g.title}>{renderGroup(g)}</Fragment>)}
        </SettingsChapter>
      )}

      {/* DESIGN §9: the settings that are not on this page, named, so the
          operator who came here for the theme or a rate limit leaves by a
          link rather than by the sidebar's twenty entries. */}
      <ElsewherePages user={user} />
      </SettingsShell>

      {previewAgeGate && <AgeGate preview onClose={() => setPreviewAgeGate(false)} />}
    </div>
  );
}


/**
 * The stored mirror list is canonical JSON; the operator edits it as lines.
 * "host  label" per line — the same shape the validator accepts, so what is
 * typed here is what is saved, and the JSON that comes back on reload is
 * rendered as lines again.
 */
function mirrorsToLines(raw) {
  if (!raw) return '';
  if (String(raw).trim().startsWith('[')) {
    try {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        return list.map((m) => (m.label ? `${m.host}  ${m.label}` : m.host)).join('\n');
      }
    } catch { /* fall through to the raw text */ }
  }
  return String(raw);
}

/** Stored JSON `[{ name, content }]` → the textarea's "name  content" lines. */
function verificationToLines(value) {
  if (!value) return '';
  if (!String(value).trim().startsWith('[')) return String(value);
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr.map((v) => `${v.name}  ${v.content}`).join('\n') : '';
  } catch { return ''; }
}

/**
 * The search-engine card's controls. The description sits OUTSIDE the
 * indexing switch because it also feeds the link-preview card, which has a
 * switch of its own; the canonical host, currency and verification tokens
 * only mean anything to a search engine and hide until one is invited.
 */
function SeoEditor({ settings, handleChange }) {
  const indexing = settings.seo_indexing === 'true';
  const guest = settings.allow_guest_browsing === 'true';
  const [verifyLines, setVerifyLines] = useState(() => verificationToLines(settings.seo_verification));
  useEffect(() => { setVerifyLines(verificationToLines(settings.seo_verification)); }, [settings.seo_verification]);
  const description = settings.seo_description || '';

  return (
    <div className="aset-fields">
      <SwitchRow
        id="seo-indexing"
        title="Let search engines index this store"
        hint="Publishes /sitemap.xml, a robots.txt that allows the public pages, a canonical address and structured data on each. Off, every page says noindex and the sitemap does not exist. Not access control: a crawler that ignores robots.txt reads whatever a guest can."
        icon={Radar}
        checked={indexing}
        onChange={(on) => handleChange('seo_indexing', on ? 'true' : 'false')}
      >
        {!guest && (
          <p className="aset-note is-warn">
            <AlertTriangle size={13} aria-hidden="true" />
            Guest browsing is off, so a search engine sees a sign-in card where the catalogue would be. Only the
            home page, your pages and the canary are listed; product pages are marked noindex.
            {' '}<Link to="/admin/settings?hl=allow-guest-browsing">Access &amp; entry</Link>
          </p>
        )}
        <div className="form-group">
          <label htmlFor="seo-canonical-host">Canonical address</label>
          <input
            id="seo-canonical-host"
            className="glass-input"
            value={settings.seo_canonical_host || ''}
            onChange={(e) => handleChange('seo_canonical_host', e.target.value)}
            placeholder="store.example"
            spellCheck="false"
            autoCapitalize="none"
          />
          <p className="setting-row-hint">
            The one address search engines should index this store under. Leave it empty to use whichever
            address the visitor is on; set it when the store answers at several — apex and www, a domain and an
            onion — so a crawler does not see one copy per address.
          </p>
        </div>
        <div className="form-group">
          <label htmlFor="seo-currency">Price currency</label>
          <input
            id="seo-currency"
            className="glass-input"
            value={settings.seo_currency || ''}
            onChange={(e) => handleChange('seo_currency', e.target.value.toUpperCase())}
            placeholder="USD"
            maxLength={3}
            style={{ maxWidth: '8ch' }}
            spellCheck="false"
          />
          <p className="setting-row-hint">
            Three-letter ISO code for the structured data. The storefront prints a bare number; this is the only
            place the currency is named to anyone.
          </p>
        </div>
        <div className="form-group">
          <label htmlFor="seo-verification">Site verification tags</label>
          <textarea
            id="seo-verification"
            className="glass-input"
            rows={2}
            value={verifyLines}
            onChange={(e) => { setVerifyLines(e.target.value); handleChange('seo_verification', e.target.value); }}
            placeholder={'google-site-verification  abc123\nmsvalidate.01  DEADBEEF'}
            spellCheck="false"
            autoCapitalize="none"
          />
          <p className="setting-row-hint">
            One per line: the tag name, then the token — the content value alone, not the whole tag. What
            Search Console and Bing Webmaster ask a site to carry to prove you run it.
          </p>
        </div>
        <p className="aset-note">
          <Radar size={13} aria-hidden="true" />
          Served at <a href="/robots.txt" target="_blank" rel="noopener noreferrer">/robots.txt</a> and{' '}
          <a href="/sitemap.xml" target="_blank" rel="noopener noreferrer">/sitemap.xml</a>; the head of any
          storefront page shows what a crawler is told about it.
        </p>
      </SwitchRow>
      <SwitchRow
        id="seo-social-previews"
        title="Link previews in chat apps"
        hint="A pasted link unfurls into a card — name, description and, for a product, its first picture. Separate from indexing: the picture lands in somebody's message history, which is a different kind of exposure from a listing."
        icon={MessageCircle}
        checked={settings.seo_social_previews === 'true'}
        onChange={(on) => handleChange('seo_social_previews', on ? 'true' : 'false')}
      />
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="seo-description">Store description</label>
        <textarea
          id="seo-description"
          className="glass-input"
          rows={2}
          maxLength={300}
          value={description}
          onChange={(e) => handleChange('seo_description', e.target.value)}
          placeholder="e.g. Lab-tested flower and concentrates, shipped in plain packaging within 24 hours. Bitcoin, Monero and Litecoin."
        />
        <p className="setting-row-hint">
          What a search result or a link preview quotes under the store&apos;s name; the tagline stands in when
          this is empty. {description.length}/300 — search results show about 160.
        </p>
      </div>
    </div>
  );
}

/**
 * What a clearnet visitor is served — `utils/clearnetPolicy` on the server.
 * In order of how much each closes; the labels are the sentences the
 * assistant's settings index uses for the same values.
 */
const CLEARNET_POLICIES = [
  { value: 'open', label: 'Served normally', hint: 'The clearnet and the onion are two doors onto the same store.' },
  { value: 'announce', label: 'Served, and told about the onion', hint: 'Every clearnet page carries an Onion-Location header. Tor Browser offers the onion; other browsers notice nothing.' },
  { value: 'redirect', label: 'Sent to the onion', hint: 'A clearnet visit is redirected to the onion address. Works for Tor Browser on the clearnet domain; any other browser reaches a name it cannot resolve.' },
  { value: 'refuse', label: 'Refused — onion only', hint: 'A clearnet visit gets one page naming the onion and nothing else: no catalogue, no API, no sign-in. The signed mirror list, the canary and the certificate renewal path stay reachable.' },
];

function MirrorsEditor({ value, note, policy, onChange, onNoteChange, onPolicyChange }) {
  // Lines are local state so a half-typed line is not re-serialised under
  // the cursor; the setting is written on every change, as lines, and the
  // server canonicalises on save.
  const [lines, setLines] = useState(() => mirrorsToLines(value));
  const [status, setStatus] = useState(null);
  useEffect(() => { setLines(mirrorsToLines(value)); }, [value]);
  useEffect(() => {
    let alive = true;
    api.get('/settings/mirrors').then((d) => { if (alive) setStatus(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const count = lines.split('\n').map((l) => l.trim()).filter(Boolean).length;
  const signed = !!status?.signed;
  // Whether the list as typed holds an onion — the same shape the server
  // accepts (config/mirrorKeys: 56 base32 characters and `.onion`), so the
  // warning under the policy select agrees with the refusal it predicts.
  const hasOnion = lines.split('\n').some((l) => /^[a-z2-7]{56}\.onion(\s|$)/i.test(l.trim()));

  return (
    <div className="aset-fields">
      <div className="form-group">
        <label htmlFor="store-mirrors">Addresses, one per line</label>
        <textarea
          id="store-mirrors"
          className="glass-input"
          rows={5}
          value={lines}
          onChange={(e) => { setLines(e.target.value); onChange(e.target.value); }}
          placeholder={'store.example  Main site\nbackup.example\nxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.onion  Tor'}
          spellCheck="false"
          autoCapitalize="none"
        />
        <p className="setting-row-hint">
          Hosts only — no https://, no path. A label after two spaces is optional. A v3 onion is
          56 characters; anything else calling itself an onion is refused on save.
        </p>
      </div>
      <div className="form-group">
        <label htmlFor="store-mirrors-note">Note under the list</label>
        <textarea
          id="store-mirrors-note"
          className="glass-input"
          rows={2}
          maxLength={500}
          value={note || ''}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="e.g. Verify this list against the fingerprint on the PGP page before trusting any address."
        />
      </div>
      {status && (
        <p className={`aset-note${count > 0 && !signed ? ' is-warn' : ''}`}>
          <ShieldCheck size={13} aria-hidden="true" />
          {count === 0
            ? 'No mirrors listed — the storefront shows no mirror strip and /mirrors.txt says so.'
            : signed
              ? <>Signed with store key <code>{String(status.fingerprint || '').slice(-16)}</code> and served at <a href="/mirrors.txt" target="_blank" rel="noopener noreferrer">/mirrors.txt</a>. Visitors on a listed address see a green strip in the footer; on an unlisted one, a warning.</>
              : <>Served <strong>unsigned</strong> at <a href="/mirrors.txt" target="_blank" rel="noopener noreferrer">/mirrors.txt</a>: {status.unsigned_reason || 'the store cannot sign unattended.'} An unsigned list is a claim any clone can copy.</>}
        </p>
      )}

      {/* ── Onion-only mode ──
          Under the list because it needs the list: every policy but `open`
          points at the first .onion in it, and the server refuses to save one
          without. The select is never disabled on that account — a greyed
          control with no sentence is a puzzle — the sentences below say what
          would happen and why the save would be refused. */}
      <div className="form-group" style={{ marginTop: 'var(--sp-3)' }}>
        <label htmlFor="clearnet-policy" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
          <Globe size={13} aria-hidden="true" /> Clearnet visitors
        </label>
        <select
          id="clearnet-policy"
          className="glass-input"
          value={policy ?? 'open'}
          onChange={(e) => onPolicyChange(e.target.value)}
        >
          {CLEARNET_POLICIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <p className="setting-row-hint">
          {(CLEARNET_POLICIES.find((p) => p.value === (policy ?? 'open')) || CLEARNET_POLICIES[0]).hint}
        </p>
        {(policy ?? 'open') !== 'open' && !hasOnion && (
          <p className="aset-note is-warn">
            <ShieldCheck size={13} aria-hidden="true" />
            No .onion in the list above. Add one first — the save will be refused until there is somewhere to send people.
          </p>
        )}
        {['redirect', 'refuse'].includes(policy) && status?.viewer?.kind === 'clearnet' && (
          <p className="aset-note is-warn">
            <ShieldCheck size={13} aria-hidden="true" />
            You are reading this over the clearnet. The save will be refused from here: switch to the onion address (or the machine itself) and turn it on from there, so the setting cannot lock you out of the panel that changes it.
          </p>
        )}
        {status?.viewer?.kind && (
          <p className="setting-row-hint">
            This page arrived on {status.viewer.kind === 'local' ? 'a local address' : `a${status.viewer.kind === 'onion' || status.viewer.kind === 'i2p' ? 'n' : ''} ${status.viewer.kind} address`}, as the server sees it.
            {status.viewer.kind === 'local' && ' If you opened it on a domain, the edge in front of the store is not forwarding the Host header, and a policy saved here would guard nothing — fix that first.'}
          </p>
        )}
      </div>
    </div>
  );
}


const RAIL_ROWS = [
  ['btc', 'Bitcoin'], ['xmr', 'Monero'], ['ltc', 'Litecoin'],
  ['cash_in_mail', 'Cash in the mail'], ['zelle', 'Zelle'], ['demo', 'Demo rail'],
];

/**
 * One row per rail: kind (percent / flat) and a signed value. Negative is a
 * discount, positive a fee; a blank row is no adjustment. The stored value
 * is the canonical JSON the server writes back, so a row typed as `-2` and
 * saved reloads as `-2`.
 */
function RailPricingEditor({ value, onChange }) {
  const parsed = (() => { try { return JSON.parse(value || '{}') || {}; } catch { return {}; } })();
  const set = (rail, patch) => {
    const next = { ...parsed };
    const entry = { kind: 'percent', ...(next[rail] || {}), ...patch };
    if (entry.value === '' || entry.value === null || entry.value === undefined || Number(entry.value) === 0) delete next[rail];
    else next[rail] = { kind: entry.kind, value: Number(entry.value) };
    onChange(Object.keys(next).length ? JSON.stringify(next) : '');
  };
  return (
    <div className="form-group" data-search-target="payment-rail-adjustments">
      <label>Price by payment method</label>
      <p className="setting-row-hint" style={{ marginBottom: 'var(--sp-2)' }}>
        A fee (positive) or discount (negative) per rail, applied to the order's goods after volume tiers
        and sales and before any coupon — shown to the buyer as its own line at checkout. The catalogue
        keeps showing base prices. Leave a rail blank for no adjustment.
      </p>
      <div className="rail-rows">
        {RAIL_ROWS.map(([rail, label]) => {
          const entry = parsed[rail] || { kind: 'percent', value: '' };
          return (
            <div key={rail} className="rail-row">
              <span className="rail-row-name">{label}</span>
              <select
                className="glass-input"
                value={entry.kind || 'percent'}
                onChange={(e) => set(rail, { kind: e.target.value })}
                aria-label={`${label} adjustment kind`}
              >
                <option value="percent">% of goods</option>
                <option value="flat">$ flat</option>
              </select>
              <input
                className="glass-input"
                type="number"
                step="0.01"
                min={entry.kind === 'flat' ? -1000 : -50}
                max={entry.kind === 'flat' ? 1000 : 50}
                placeholder="0"
                value={entry.value === undefined ? '' : entry.value}
                onChange={(e) => set(rail, { value: e.target.value })}
                aria-label={`${label} adjustment value, negative for a discount`}
              />
              <span className={`rail-row-say${Number(entry.value) < 0 ? ' is-off' : Number(entry.value) > 0 ? ' is-fee' : ''}`}>
                {Number(entry.value) < 0 ? 'discount' : Number(entry.value) > 0 ? 'fee' : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
