/*
 * The store's service worker: push notifications AND the offline shell.
 *
 * ONE worker, on purpose. Two workers cannot both control one scope, so a
 * second file registered "for offline" would evict this one and silently
 * break push. Keep the filename too — renaming it orphans every existing
 * registration, and the push subscriptions hanging off them.
 *
 * ── What is cached, and what never is ─────────────────────────────────────
 *
 *   shell    the built app: `/` (index.html), /assets/* (hashed, immutable),
 *            /fonts/*, the icons and the manifest. Cache-first: the bundle is
 *            addressed by content hash, so a cached copy is the right copy
 *            until the build changes — see versioning.
 *   catalog  product lists and product pages, categories, brands, tags, the
 *            public settings, the operator's pages, the store key and the
 *            mirror list. Network-first, cache as the fallback: a buyer on a
 *            filtered or flaky connection still gets the shelf they saw last,
 *            marked as such by the page (components/OfflineBar.jsx).
 *   media    product and logo images under /uploads. Cache-first, bounded.
 *
 * Nothing else is touched — the request goes to the network as if no worker
 * existed. That covers every mutation (only GET is looked at), every order,
 * the cart, auth, the profile, wishlists, support, sub-users, sockets, and the
 * upload subtrees that carry identity (avatars, chat, reviews). Cached order
 * pages would be retained identity on the buyer's disk, which is the one
 * thing this store exists not to keep; the allowlist is the guard, and it is
 * an allowlist rather than a denylist so a new endpoint is uncached until
 * somebody decides otherwise.
 *
 * ── Versioning ────────────────────────────────────────────────────────────
 *
 * The build stamps this file's bytes and precache list. An already-open app
 * can discover a deployment with registration.update(), without first loading
 * the new page. Updates WAIT for the user's refresh action. The URL and scope
 * stay the same so existing push subscriptions survive the migration.
 */

const BUILD = '__CS_BUILD_ID__';
const VERSION = BUILD.startsWith('__CS_') ? 'dev' : BUILD;
const BUILD_ASSETS = /* __CS_PRECACHE__ */ [];
const SHELL = `cs-shell-${VERSION}`;
const CATALOG = `cs-public-catalog-${VERSION}`;
const MEDIA = `cs-media-${VERSION}`;
const META = 'cs-push-meta';
const KEEP = new Set([SHELL, CATALOG, MEDIA, META]);
const MEDIA_MAX = 200;
const CATALOG_MAX = 100;

let storeName = 'Store';

/*
 * The companion, as a PNG the page drew for us.
 *
 * A notification has to name its icon by URL and this store may have no logo
 * uploaded — the fallback below used to be `/uploads/logo/logo.png`, a file
 * that 404s on a fresh install, which is a notification wearing the browser's
 * generic bell. Fetching a hosted placeholder is the one thing this project
 * will not do (CLAUDE.md: nothing may depend on a third party being
 * reachable), so the page renders the shop's own animal to a data URL in the
 * shop's own palette and hands it over (utils/companionIcon.js).
 *
 * Kept in a separate metadata cache rather than in a variable, because a service worker
 * is stopped and restarted freely: a push arriving twenty minutes after the
 * tab was closed runs in a worker whose memory is empty, which is exactly the
 * push most in need of an icon.
 */
const ICON_KEY = '/__companion-icon';

async function rememberIcon(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:image/png')) return;
  const cache = await caches.open(META);
  await cache.put(ICON_KEY, new Response(dataUrl, {
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  }));
}

async function rememberedIcon() {
  try {
    const cache = await caches.open(META);
    const hit = await cache.match(ICON_KEY);
    return hit ? await hit.text() : null;
  } catch { return null; }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'SET_STORE_NAME') {
    storeName = event.data.storeName || storeName;
    event.waitUntil(caches.open(META).then((cache) => cache.put('/__store-name', new Response(storeName))));
  }
  if (event.data?.type === 'SET_COMPANION_ICON') {
    event.waitUntil(rememberIcon(event.data.dataUrl));
  }
});

/* ── Lifecycle ─────────────────────────────────────────────────────────── */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    const shell = await fetch(new Request('/', { cache: 'reload' }));
    if (!shell.ok || !shell.headers.get('Content-Type')?.includes('text/html')) {
      throw new Error('The new app shell could not be downloaded');
    }
    // A rolling deploy can serve the worker from one release and HTML from
    // another. Never offer that mixture as an offline-ready update.
    const html = await shell.clone().text();
    if (VERSION !== 'dev' && !html.includes(`name="cs-build" content="${VERSION}"`)) {
      throw new Error('The app shell and worker belong to different builds');
    }
    await cache.addAll(BUILD_ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    await cache.put('/', shell);
    // No skipWaiting here. A first install activates naturally; an update
    // waits until the user accepts, or all old windows are closed.
  })());
});

async function clientBuild(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const done = (value) => { clearTimeout(timer); channel.port1.close(); resolve(value); };
    const timer = setTimeout(() => done(null), 1500);
    channel.port1.onmessage = (event) => done(typeof event.data === 'string' ? event.data : null);
    try { client.postMessage({ type: 'GET_CLIENT_BUILD' }, [channel.port2]); }
    catch { done(null); }
  });
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const builds = await Promise.all(windows.map(clientBuild));
    // Other tabs may still have forms open. Retain their hashed chunks until
    // a later activation sees they are gone. An old/suspended client that
    // cannot answer also keeps its cache: missing evidence is not consent.
    for (const key of await caches.keys()) {
      if (KEEP.has(key)) continue;
      if (key.startsWith('cs-shell-') && (builds.includes(null) || builds.some((id) => key === `cs-shell-${id}`))) continue;
      if (/^cs-(shell-|catalog-|public-catalog-|media-)/.test(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/* ── Fetch ─────────────────────────────────────────────────────────────── */

const CATALOG_RE = /^\/api\/products(\/(featured|categories|brands|tags|\d+))?$/;
const STATIC_RE = /^\/(favicon\.(ico|svg)|icon-\d+\.png|icon-maskable-\d+\.png|apple-touch-icon(-precomposed)?\.png|manifest\.json)$/;

function classify(url, request) {
  const p = url.pathname;
  // A top-level visit to an API/download URL is still private data, not
  // index.html. Never put it under '/' or answer it with the offline shell.
  if (/^\/(api|uploads|socket\.io)(\/|$)/.test(p) && request.mode === 'navigate') return null;
  if (request.mode === 'navigate') return 'shell';
  if (p.startsWith('/assets/') || p.startsWith('/fonts/')) return 'static';
  if (STATIC_RE.test(p)) return 'identity';
  if (p.startsWith('/uploads/products/') || p.startsWith('/uploads/logo/')) return 'media';
  if (CATALOG_RE.test(p)) return 'catalog';
  if (p === '/api/settings/public' || p.startsWith('/api/settings/pages/')
    || p === '/api/settings/mirrors' || p === '/api/store-pgp/public') return 'catalog';
  return null;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const kind = classify(url, request);
  // Catalog prices, visibility and watch flags can be user-specific. Cache
  // only anonymous reads; an Authorization header must never enter a cache.
  if (request.headers.has('Authorization') && kind === 'catalog') return;
  if (!kind) return;
  if (kind === 'shell') event.respondWith(shellFirst(request));
  else if (kind === 'static') event.respondWith(cacheFirst(request, SHELL));
  else if (kind === 'media') event.respondWith(cacheFirst(request, MEDIA, MEDIA_MAX));
  else if (kind === 'identity') event.respondWith(networkFirst(request, MEDIA, MEDIA_MAX));
  else event.respondWith(networkFirst(request, CATALOG, CATALOG_MAX));
});

/** Keep HTML paired with its precached assets. Fetching new index.html
 * into an old cache used to leave offline visits with missing new chunks. */
async function shellFirst(request) {
  // Consult the network to preserve redirects and real 404s, but a successful
  // SPA navigation uses THIS worker's complete shell until the update wins.
  const cache = await caches.open(SHELL);
  const cached = await cache.match('/');
  try {
    const res = await fetch(request);
    if (res.status >= 500) return cached || res;
    if (!res.ok || res.redirected || !res.headers.get('Content-Type')?.includes('text/html')) return res;
    return cached || res;
  } catch {
    return cached || offlineResponse('text/html');
  }
}

async function putSafely(cache, request, response, max) {
  if (!response.ok || /(?:no-store|private)/i.test(response.headers.get('Cache-Control') || '')) return;
  try {
    await cache.put(request, response.clone());
    if (max) await trim(cache, max);
  } catch { /* Quota/private-mode failures must not turn a good network reply into an error. */ }
}

async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  if (new URL(request.url).pathname.startsWith('/assets/')) {
    // A different tab may still execute the previous bundle after this one
    // accepts the update. Its retained chunks remain usable, even offline.
    for (const key of await caches.keys()) {
      if (!key.startsWith('cs-shell-') || key === SHELL) continue;
      const previous = await (await caches.open(key)).match(request);
      if (previous) return previous;
    }
  }
  const res = await fetch(request);
  await putSafely(cache, request, res, max);
  return res;
}

/** Only explicitly public endpoints reach here. Bound query-string variants
 * and identify stale fallback responses so the page can tell the buyer. */
async function networkFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) { await putSafely(cache, request, res, max); return res; }
    if (res.status >= 500) {
      const cached = await cache.match(request);
      if (cached) return staleResponse(cached);
    }
    return res;
  } catch {
    const cached = await cache.match(request);
    return cached ? staleResponse(cached) : offlineResponse('application/json');
  }
}

function staleResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('X-CS-Offline', '1');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Oldest-first eviction, so a long browse does not fill the disk. */
async function trim(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

function offlineResponse(type) {
  const body = type === 'application/json'
    ? JSON.stringify({ error: 'You are offline — this needs a connection.', offline: true })
    : '<!doctype html><title>Offline</title><p style="font-family:sans-serif;padding:2rem">You are offline and this page was never cached. Reconnect and try again.</p>';
  return new Response(body, { status: 503, headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
}

/* ── Push ──────────────────────────────────────────────────────────────── */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    if (!data || typeof data !== 'object') throw new Error('Not a notification object');
    event.waitUntil((async () => {
      // The server's icon wins, then the shop's logo if it has one, then the
      // companion the page drew. Asked for last because it is the fallback,
      // and read at push time because the palette may have changed since.
      const drawn = data.icon ? null : await rememberedIcon();
      const options = {
        body: data.body || '',
        icon: data.icon || drawn || '/icon-192.png',
        badge: data.badge || drawn || '/icon-192.png',
        data: { url: data.url || '/' },
        tag: data.tag || 'default',
        renotify: true,
      };
      const name = await (await caches.open(META)).match('/__store-name');
      await self.registration.showNotification(data.title || (name && await name.text()) || storeName, options);
    })());
  } catch (err) {
    // Fallback for non-JSON
    event.waitUntil(
      self.registration.showNotification(storeName, {
        body: event.data.text(),
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let url;
  try {
    url = new URL(event.notification.data?.url || '/', self.location.origin);
    if (url.origin !== self.location.origin) url = new URL('/', self.location.origin);
  } catch { url = new URL('/', self.location.origin); }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url.href && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url.href);
      }
    })
  );
});
