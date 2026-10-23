import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { api } from '../utils/api';
import { computeThemeVars, resolveMode, pickMode } from '../theme/computeVars';
import { DEFAULT_THEME } from '../theme/defaults';
import { setFaviconBase } from '../utils/favicon';
import { setStoreIdentity } from '../utils/documentHead';

const ThemeContext = createContext(null);

/**
 * Colour modes are 'dark', 'light' and 'auto'; `auto` follows the visitor's OS.
 * The store sets a default; each visitor may override it (unless the operator
 * locked that off), and the override lives in this browser only.
 *
 * The palette itself lives in `theme/defaults.js` and the derivation in
 * `theme/computeVars.js`. This file is now only plumbing: fetch, cache, apply.
 * That split is what lets the editor render the *other* mode for a preview
 * without touching the document, and lets the derivation be unit-tested.
 */

/** Where the pre-paint bootstrap in index.html looks for the last known palette. */
export const THEME_CACHE_KEY = 'cs.theme.v2';

/** The visitor's own mode choice. Absent means "whatever the store says". */
export const VISITOR_MODE_KEY = 'cs.mode.v1';

function readVisitorMode() {
  try {
    const v = window.localStorage.getItem(VISITOR_MODE_KEY);
    return v === 'dark' || v === 'light' || v === 'auto' ? v : null;
  } catch {
    return null;
  }
}

function writeVisitorMode(mode) {
  try {
    if (mode) window.localStorage.setItem(VISITOR_MODE_KEY, mode);
    else window.localStorage.removeItem(VISITOR_MODE_KEY);
  } catch {
    // Private mode: the choice still applies this session via React state.
  }
}

/**
 * The mode actually in force for this visitor, still unresolved ('auto' stays
 * 'auto'). The allow flag is read here, once, so no caller can accidentally
 * honour a visitor override on a store that locked the mode.
 */
function effectiveIntent(settings) {
  const allow = settings.theme_allow_visitor_mode !== 'false';
  return pickMode(settings.theme_mode ?? DEFAULT_THEME.theme_mode, readVisitorMode(), allow);
}

/**
 * Conditions the stylesheet cannot enforce on its own. The theme lands as
 * inline styles on <html>, which outrank every selector — including the
 * `@media (prefers-contrast)` and `@supports` blocks that used to try to
 * flatten glass from CSS. They silently lost the moment the theme applied,
 * so the conditions are detected here and fed through the derivation, where
 * nothing can outrank them. The CSS blocks remain as the pre-JS floor.
 */
function envFlags() {
  if (typeof window === 'undefined' || !window.matchMedia) return {};
  const supportsBackdrop = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
    && (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));
  return {
    increaseContrast: window.matchMedia('(prefers-contrast: more)').matches,
    reduceTransparency:
      window.matchMedia('(prefers-reduced-transparency: reduce)').matches || !supportsBackdrop,
  };
}

function applyFavicon(logoPath, rounded) {
  if (!logoPath) return;
  const img = new window.Image();
  img.onload = () => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (rounded) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
    }
    /*
     * Fit inside the square, centred — do not fill it.
     *
     * This was `drawImage(img, 0, 0, size, size)`, the form that scales the
     * source to the destination rectangle with no regard for its aspect ratio.
     * On the `pwa_icon` path that was invisible, because the appicon upload
     * profile already letterboxes onto an exact 512×512 square. On the
     * `store_logo` fallback below it was not: a logo is typically a wordmark —
     * the shipped one is 512×55 — and squeezing that into 128×128 renders the
     * store's name nine times too tall, in a 16px tab, where the result is an
     * unreadable smear. The operator sees a correct logo in the admin panel and
     * a broken one in the tab, with nothing connecting the two.
     *
     * `Math.min` of the two ratios is the contain fit; the offsets centre what
     * is left over. A square source is unaffected, so the icon path renders
     * exactly as it did.
     */
    const scale = Math.min(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    // Declared rather than written. The admin's AI status light borrows the
    // tab while a background job is running, and one element with two writers
    // is how a tab keeps whichever wrote last — see utils/favicon.js.
    setFaviconBase(canvas.toDataURL('image/png'), 'image/png');
  };
  img.src = logoPath;

  // The apple-touch icon points at the REAL file, not the canvas data URL:
  // iOS Safari has never honoured data: URLs for home-screen icons, so the
  // canvas route silently produced the screenshot-of-the-page fallback tile.
  // iOS rounds and masks the tile itself, so the square source is correct
  // as-is (and iOS 14+ decodes WebP).
  const apple = document.getElementById('dynamic-apple-icon');
  if (apple) {
    apple.href = logoPath;
    apple.removeAttribute('type');
  }
}

let _manifestBlobUrl = null;

/** @param {{bg: string, isLight: boolean}} ground the palette actually in force */
function applyManifest(s, { bg, isLight }) {
  const pwaColor = s.pwa_theme_color || bg;
  // Everything in the manifest must be ABSOLUTE. It is served from a blob:
  // URL, and relative members resolve against the manifest's own URL — a blob
  // has no path to resolve against, so a relative start_url or icon src
  // silently breaks installability while looking perfectly fine in the JSON.
  const abs = (p) => new URL(p, window.location.origin).href;
  /*
   * MANIFEST ICONS COME FROM `pwa_icon` OR FROM THE SHIPPED SET. Never from
   * `store_logo`, which is still the favicon's fallback a few lines up.
   *
   * The logo used to stand in here, declared — whatever it actually was — as
   * `512x512`. The shipped logo is 512×55. A manifest that describes an icon
   * under a size it does not have is the classic silent installability failure:
   * the browser measures it, disagrees, and drops the install prompt with
   * nothing logged. A wordmark was never going to survive a launcher's crop
   * anyway, which is what the old comment here said while the code did it.
   *
   * The three derived files are written beside the upload by the server at
   * upload time (server/services/appIcons.js) and the naming rule is shared
   * with it — `<base>-192.png`, `-512.png`, `-maskable.png`. If you rename them
   * there, rename them here; the server's own /manifest.json checks the files
   * exist before naming them, and this one cannot.
   */
  const derived = (p, suffix) => abs(String(p).replace(/\.[a-z0-9]+$/i, '') + suffix);
  const iconsFor = (p) => [
    { src: derived(p, '-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: derived(p, '-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: derived(p, '-maskable.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  /*
   * The shipped icon set, used when the store has uploaded neither.
   *
   * This blob REPLACES the static client/public/manifest.json the document
   * links, so "no upload yet" used to mean an `icons: []` manifest — and a
   * manifest with no icons is not installable at all. Every fresh deploy lost
   * the perfectly good default set the moment React hydrated, which is a
   * strange failure to debug: view-source shows a correct manifest, and the
   * browser is reading a different one.
   *
   * Both purposes are declared because they are genuinely different artwork.
   * `maskable` is letterboxed into the 80% safe circle so a launcher may crop
   * it; `any` is the full-bleed tile. Declaring one file as both is what makes
   * an icon look correct on one phone and shaved on the next.
   */
  const shippedIcons = [
    { src: abs('/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: abs('/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: abs('/icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  const manifest = {
    id: '/',
    name: s.pwa_name || s.store_name || DEFAULT_THEME.store_name,
    // Falls back through the same chain as `name` rather than to a generic
    // 'Store'. This is the label under the home-screen icon, so a store that
    // set a name and no short name was installing as somebody else's word.
    // Launchers truncate around 12 characters; that is the operator's call to
    // make with pwa_short_name, not ours to make for them by inventing a word.
    short_name: s.pwa_short_name || s.store_name || DEFAULT_THEME.store_name,
    description: s.pwa_description || s.store_tagline || '',
    start_url: abs('/'),
    scope: abs('/'),
    display: s.pwa_display || 'standalone',
    theme_color: pwaColor,
    background_color: s.pwa_background_color || bg,
    // Purpose 'any', deliberately not 'maskable': the appicon pipeline
    // letterboxes onto a TRANSPARENT square, and a maskable claim tells the
    // launcher it may zoom-crop into the safe zone — which would crop the
    // very letterboxing that keeps the artwork whole. Without the claim,
    // Android letterboxes it itself, which is the honest rendering.
    // The declared 512x512 is guaranteed by the appicon profile; a store
    // still on the logo fallback inherits the claim (as it always did) until
    // an icon is uploaded, which is the actual fix for a wordmark logo.
    icons: s.pwa_icon ? iconsFor(s.pwa_icon) : shippedIcons,
  };
  if (_manifestBlobUrl) URL.revokeObjectURL(_manifestBlobUrl);
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
  _manifestBlobUrl = URL.createObjectURL(blob);
  let link = document.getElementById('dynamic-manifest');
  if (!link) {
    link = document.createElement('link');
    link.id = 'dynamic-manifest';
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  link.href = _manifestBlobUrl;

  // Browser chrome for the page being looked at *now*, which is the page
  // background — not the manifest's theme_color. Those are different jobs: the
  // manifest colours an installed app once, while this tints the address bar on
  // every view, so pinning it to a dark `pwa_theme_color` would leave a
  // near-black status bar sitting above a white page in light mode.
  let meta = document.getElementById('dynamic-theme-color');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.id = 'dynamic-theme-color';
    document.head.appendChild(meta);
  }
  meta.content = bg;

  // Native form controls, scrollbars and autofill follow this. index.html's own
  // tag carries this id, so the lookup below finds and updates it in place
  // rather than appending a second one — two color-scheme metas resolve
  // first-in-tree-order and the appended one would always lose.
  let scheme = document.getElementById('dynamic-color-scheme');
  if (!scheme) {
    scheme = document.createElement('meta');
    scheme.name = 'color-scheme';
    scheme.id = 'dynamic-color-scheme';
    document.head.appendChild(scheme);
  }
  scheme.content = isLight ? 'light' : 'dark';
}

/**
 * Write a computed palette onto `<html>`.
 *
 * These land as inline styles, which beat any stylesheet selector — so anything
 * that differs between modes must come through here rather than living only in
 * a `[data-theme="light"]` CSS rule, or the CSS rule silently loses.
 */
function applyThemeVars({ vars, dataTheme, bg }) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = dataTheme;
  // background-color, not the `background` shorthand: the shorthand would wipe
  // the gradient layer the stylesheet paints on top of it.
  document.body.style.backgroundColor = bg;
}

/**
 * Stash the computed palette so the next cold load can paint it before React.
 *
 * `mode` is the *intent* — possibly 'auto' — not the resolved mode. The
 * bootstrap's "has the OS flipped since this was written?" guard keys off it,
 * and `computed.mode` is always already resolved to dark/light, which made
 * that guard unreachable and let an `auto` store replay a stale mode.
 */
function cachePalette(computed, intent, allow, flags = {}) {
  try {
    window.localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({
      v: 2,
      dataTheme: computed.dataTheme,
      bg: computed.bg,
      mode: intent,
      allow,
      // The accessibility conditions this palette was SOLVED under. The
      // bootstrap in index.html refuses to replay a cache whose flags no
      // longer match, and falls through to the stylesheet floor instead —
      // without this it would paint full glass and live glow over a visitor
      // who had turned High Contrast on since their last visit, because
      // inline styles outrank the @media block that exists to stop exactly
      // that. Short keys because this is re-serialised on every apply.
      flags: { c: !!flags.increaseContrast, t: !!flags.reduceTransparency },
      vars: computed.vars,
    }));
  } catch {
    // Private mode, or the quota is full. The palette still applies this
    // session; only the next cold load loses its head start.
  }
}

function applyAll(settings, modeOverride) {
  const intent = modeOverride ?? effectiveIntent(settings);
  // Read once and passed to both, so the palette and the flags recorded
  // beside it can never describe different conditions.
  const flags = envFlags();
  const computed = computeThemeVars(settings, { mode: intent, ...flags });
  applyThemeVars(computed);
  // A preview must never become the next cold-load palette. Reloading during
  // an experiment used to replay unsaved colours before settings arrived.
  if (!modeOverride) cachePalette(computed, intent, settings.theme_allow_visitor_mode !== 'false', flags);

  if (settings.store_name) {
    // The tab title is composed in utils/documentHead.js from the store, the
    // route and the page. This used to be `document.title = store_name`,
    // written on every theme application — so opening the About page and
    // then toggling dark mode put the store's name back over the page's.
    setStoreIdentity({
      name: settings.store_name,
      tagline: settings.store_tagline || '',
      description: settings.seo_description || settings.store_tagline || '',
      indexing: settings.seo_indexing === 'true',
      guestBrowsing: settings.allow_guest_browsing === 'true',
    });
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SET_STORE_NAME',
        storeName: settings.store_name,
      });
    }
  }
  // The square app icon feeds everything tab- and launcher-shaped; the logo
  // only stands in while no icon has been uploaded.
  const favSource = settings.pwa_icon || settings.store_logo;
  if (favSource) applyFavicon(favSource, settings.favicon_rounded === 'true');
  applyManifest(settings, { bg: computed.bg, isLight: computed.isLight });
  return computed;
}

export function ThemeProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_THEME);
  const [loaded, setLoaded] = useState(false);
  const [previewMode, setPreviewMode] = useState(null);
  const previewModeRef = useRef(null);
  // Bumped whenever the OS preference flips so `auto` re-resolves.
  const [systemTick, setSystemTick] = useState(0);
  // Mirrors localStorage so consumers (the navbar toggle) re-render on change.
  const [visitorMode, setVisitorModeState] = useState(() =>
    typeof window === 'undefined' ? null : readVisitorMode());

  // Mirrors `settings` so `updateTheme` can merge without a functional update.
  // Painting the document is a side effect, and a side effect inside a state
  // updater runs twice under StrictMode and can fire during another
  // component's render — which is exactly the "cannot update a component while
  // rendering a different component" warning.
  const settingsRef = useRef(DEFAULT_THEME);

  const commit = useCallback((merged, previewMode) => {
    settingsRef.current = merged;
    previewModeRef.current = previewMode ?? null;
    setPreviewMode(previewMode ?? null);
    applyAll(merged, previewMode);
    setSettings(merged);
  }, []);

  useEffect(() => {
    api.get('/settings/public')
      .then((data) => commit({ ...settingsRef.current, ...data }))
      .catch(() => commit(DEFAULT_THEME))
      .finally(() => setLoaded(true));
  }, [commit]);

  // Settings can arrive before the first worker claims the page. Replay the
  // current name on activation as well, so push after closing the app retains
  // the shop identity even on the first visit.
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const sendName = () => sw.controller?.postMessage({
      type: 'SET_STORE_NAME', storeName: settingsRef.current.store_name,
    });
    sw.addEventListener('controllerchange', sendName);
    return () => sw.removeEventListener('controllerchange', sendName);
  }, []);

  // In `auto`, the OS can change under us — at sunset, or when the visitor
  // toggles it — and the page must follow without a reload.
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setSystemTick((t) => t + 1);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    if (systemTick === 0) return;
    // The *effective* intent, not the store's: a visitor override of 'auto'
    // must follow the OS even when the store itself is pinned to one mode.
    if (!previewModeRef.current && effectiveIntent(settingsRef.current) === 'auto') applyAll(settingsRef.current);
  }, [systemTick]);

  // Contrast and transparency preferences can change mid-session (an OS
  // accessibility toggle). These conditions ride the derivation — see
  // envFlags() — so a repaint is the only way they can take effect.
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const queries = ['(prefers-contrast: more)', '(prefers-reduced-transparency: reduce)']
      .map((q) => window.matchMedia(q));
    const onChange = () => applyAll(settingsRef.current, previewModeRef.current);
    queries.forEach((mq) => mq.addEventListener?.('change', onChange));
    return () => queries.forEach((mq) => mq.removeEventListener?.('change', onChange));
  }, []);

  /**
   * The visitor picked a mode (or `null` to follow the store again). The
   * repaint runs inside a view transition where the engine has one, because a
   * whole-page palette inversion with no easing reads as a glitch rather than
   * a switch; engines without it (and visitors who asked for reduced motion)
   * get the instant swap.
   */
  const setVisitorMode = useCallback((next) => {
    writeVisitorMode(next);
    setVisitorModeState(next);
    const repaint = () => applyAll(settingsRef.current, previewModeRef.current);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reduced && typeof document.startViewTransition === 'function') {
      document.startViewTransition(repaint);
    } else {
      repaint();
    }
  }, []);

  /**
   * Merge a partial palette in and repaint. `previewMode` renders a mode
   * without changing which one the store is set to — the editor needs that to
   * tune the light palette while the store runs dark.
   */
  const updateTheme = useCallback((newSettings, { previewMode } = {}) => {
    commit({ ...settingsRef.current, ...newSettings }, previewMode);
  }, [commit]);

  const mode = settings.theme_mode || 'dark';
  const allowVisitorMode = settings.theme_allow_visitor_mode !== 'false';
  const value = useMemo(() => ({
    settings,
    updateTheme,
    loaded,
    // The STORE's mode. The admin editor reasons about this one.
    mode,
    // The visitor's own override, null when they follow the store.
    visitorMode,
    setVisitorMode,
    allowVisitorMode,
    // What the visitor is actually looking at, overrides and `auto` resolved.
    resolvedMode: resolveMode(previewMode ?? pickMode(mode, allowVisitorMode ? visitorMode : null, allowVisitorMode)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [settings, loaded, mode, previewMode, updateTheme, systemTick, visitorMode, setVisitorMode, allowVisitorMode]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
