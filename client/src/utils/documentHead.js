/**
 * The document's head, kept true while the router swaps pages underneath it.
 *
 * ── Two writers, one title ──────────────────────────────────────────────────
 *
 * ThemeContext used to write `document.title = store_name` every time the
 * theme was applied, and two pages wrote `document.title = page.title` when
 * their data landed. Neither knew about the other, so the tab said whichever
 * had written last: open the About page, toggle dark mode, and the tab went
 * back to the store's name. This module is the one place the title is
 * composed, from three layers that each know one thing:
 *
 *   store   the store's name and tagline, and the two settings that decide
 *           what a crawler may do (ThemeContext sets these once the public
 *           settings land);
 *   route   what the path is — a private page, the catalogue, the home page —
 *           and its default title (the Layout sets this on every navigation,
 *           from config/pageHead.js);
 *   page    what the page itself knows — a product's name, a category, an
 *           operator page's title — set through hooks/useDocumentHead.js and
 *           keyed by pathname, so a page whose data arrives after the visitor
 *           has already left cannot title the page they moved to.
 *
 * ── What it writes, and the rule for when ───────────────────────────────────
 *
 * The served document already carries the right head for the first page —
 * the server computed it (server/services/seo.js). Nothing here is written
 * until the store's identity has loaded: writing "Catalog · CryptoStore"
 * over the server's "Catalog · Nightshade" while the settings fetch is still
 * in flight would be a visible flash on every cold load, and on a Tor-fronted
 * store the fetch takes seconds. Once loaded, every navigation rewrites the
 * title, the description, the robots directive and the canonical link with
 * the same rules the server applies, so a crawler that renders JavaScript
 * and one that does not read the same answer.
 *
 * The canonical link keeps the ORIGIN the server put on it and replaces only
 * the path: the operator may have named a canonical host, and the client has
 * no way to know it except by reading what the server wrote.
 */

// With the extension: node runs the test against this file directly, and
// its ESM resolver, unlike Vite's, will not guess one.
import { routeDefaults } from '../config/pageHead.js';

export const ROBOTS_ON = 'index, follow, max-image-preview:large';
export const ROBOTS_OFF = 'noindex, nofollow, noarchive';
export const ROBOTS_PRIVATE = 'noindex, nofollow';
export const ROBOTS_SEARCH = 'noindex, follow';

const state = {
  store: { loaded: false, name: '', tagline: '', description: '', indexing: false, guestBrowsing: false },
  route: null, // { pathname, ...routeDefaults }
  page: null, // { pathname, title?, description?, robots?, canonicalPath? }
};

/**
 * Markdown as text: the subset MicroMarkdown renders, stripped the same way
 * the server strips it (services/seo.js `plain`) so an operator page's
 * snippet reads the same in the served head and after navigation.
 */
export function plainMarkdown(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~>#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A description as a search result quotes it: one line, cut at a word, with
 * an ellipsis, never longer than `max`. The server clips the same way
 * (services/seo.js `clip`), so the snippet a crawler read on load and the one
 * the client writes on navigation are the same text.
 */
export function clipDescription(text, max = 160) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trim()}…`;
}

/** The tab title: the store alone on the home page, `Page · Store` elsewhere. */
export function composeTitle(store, title, { isHome = false } = {}) {
  const name = store.name || '';
  if (!title) {
    if (isHome && store.tagline) return `${name} — ${store.tagline}`;
    return name;
  }
  return name ? `${title} · ${name}` : title;
}

/**
 * What the head should say, from the three layers. Pure, so the rules can be
 * tested without a document; `applyHead` is the only thing that writes.
 *
 * @returns {{ title: string, description: string, robots: string, canonicalPath: string|null }}
 */
export function resolveHead({ store, route, page }) {
  const r = route || { pathname: '/', ...routeDefaults('/') };
  const p = page && page.pathname === r.pathname ? page : null;
  const title = (p && p.title) || r.title || null;
  const description = (p && p.description) || store.description || '';

  let robots;
  if (r.isPrivate) robots = ROBOTS_PRIVATE;
  else if (p && p.robots) robots = p.robots;
  else if (!store.indexing) robots = ROBOTS_OFF;
  else if (r.isCatalog && !store.guestBrowsing) robots = ROBOTS_PRIVATE;
  else robots = ROBOTS_ON;

  let canonicalPath = null;
  if (!r.isPrivate && robots !== ROBOTS_PRIVATE) {
    canonicalPath = p && p.canonicalPath !== undefined ? p.canonicalPath : r.pathname;
  }

  return {
    title: composeTitle(store, title, { isHome: r.isHome }),
    description,
    robots,
    canonicalPath,
  };
}

/* ── The document ───────────────────────────────────────────────────────── */

function ensureMeta(doc, attr, name) {
  let el = doc.head.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = doc.createElement('meta');
    el.setAttribute(attr, name);
    doc.head.appendChild(el);
  }
  return el;
}

/** Write the resolved head into the document. No-op until the store has loaded. */
export function applyHead(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !state.store.loaded) return;
  const head = resolveHead(state);

  if (head.title && doc.title !== head.title) doc.title = head.title;

  const desc = doc.head.querySelector('meta[name="description"]');
  if (head.description) ensureMeta(doc, 'name', 'description').setAttribute('content', head.description);
  else if (desc) desc.remove();

  ensureMeta(doc, 'name', 'robots').setAttribute('content', head.robots);

  let canonical = doc.head.querySelector('link[rel="canonical"]');
  if (head.canonicalPath === null) {
    if (canonical) canonical.remove();
  } else {
    let origin = doc.location ? doc.location.origin : '';
    if (canonical) {
      try { origin = new URL(canonical.getAttribute('href') || '', origin || undefined).origin; } catch { /* keep the page's */ }
    } else {
      canonical = doc.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      doc.head.appendChild(canonical);
    }
    canonical.setAttribute('href', `${origin}${head.canonicalPath}`);
  }
}

/* ── The layers ─────────────────────────────────────────────────────────── */

/** ThemeContext: the store's name, tagline, description and the two crawler settings. */
export function setStoreIdentity({ name, tagline = '', description = '', indexing = false, guestBrowsing = false }) {
  state.store = { loaded: true, name: name || '', tagline, description, indexing, guestBrowsing };
  applyHead();
}

/** The Layout, on every navigation: the route's defaults. */
export function setRouteHead(pathname) {
  state.route = { pathname, ...routeDefaults(pathname) };
  applyHead();
}

/** A page, with what it knows. Keyed by pathname so a late arrival cannot mis-title the next page. */
export function setPageHead(pathname, head) {
  state.page = { pathname, ...(head || {}) };
  applyHead();
}

/** The page's cleanup — only its own entry, never one a newer page has set. */
export function clearPageHead(pathname) {
  if (state.page && state.page.pathname === pathname) {
    state.page = null;
    applyHead();
  }
}

/** For tests and diagnostics: the layers as they stand. */
export const headState = () => state;
