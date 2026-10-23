import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBuildId } from '../build-id.js';
import vm from 'node:vm';
import { watchPwaUpdates } from '../src/utils/pwa.js';
import { hasOfflineCatalog, recordCatalogResponse } from '../src/utils/offlineCatalog.js';

const emit = (target, type) => target.dispatchEvent(new Event(type));
function watcherFixture({ firstInstall = false, pending = false } = {}) {
  const sw = new EventTarget();
  sw.controller = firstInstall ? null : {};
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const timers = new Map();
  let clock = 0, online = true, reloads = 0, checks = 0, message;
  win.setInterval = win.setTimeout = (fn) => { const id = Symbol(); timers.set(id, fn); return id; };
  win.clearInterval = win.clearTimeout = (id) => timers.delete(id);
  const registration = new EventTarget();
  const makeWorker = () => Object.assign(new EventTarget(), { state: 'installing', postMessage: (data) => { message = data; } });
  let worker = makeWorker();
  registration.waiting = pending ? worker : null;
  registration.update = async () => { checks++; };
  const states = [];
  const watcher = watchPwaUpdates(registration, (state) => states.push(state), {
    sw, win, doc, now: () => clock, online: () => online, reload: () => reloads++, buildId: 'a',
  });
  return {
    sw, win, doc, registration, get worker() { return worker; }, watcher, timers,
    get state() { return states.at(-1); }, get reloads() { return reloads; },
    get message() { return message; }, get checks() { return checks; },
    advance() { clock += 60001; }, offline() { online = false; },
    install() {
      if (worker.state === 'redundant') worker = makeWorker();
      registration.installing = worker; emit(registration, 'updatefound');
      registration.waiting = worker; worker.state = 'installed'; emit(worker, 'statechange');
    },
    activate() { registration.waiting = null; sw.controller = {}; emit(sw, 'controllerchange'); },
  };
}

test('first installation never offers an update or reloads', () => {
  const f = watcherFixture({ firstInstall: true });
  f.activate();
  assert.equal(f.state.available, false); assert.equal(f.reloads, 0); f.watcher.dispose();
});
test('newly installed and already waiting workers offer a user-controlled refresh', () => {
  for (const pending of [false, true]) {
    const f = watcherFixture({ pending }); if (!pending) f.install();
    assert.equal(f.state.available, true); assert.equal(f.reloads, 0);
    f.watcher.refresh(); assert.deepEqual(f.message, { type: 'SKIP_WAITING' });
    assert.equal(f.reloads, 0); assert.equal(f.state.refreshing, true);
    f.activate(); f.activate(); assert.equal(f.reloads, 1); f.watcher.dispose();
  }
});
test('another window updating never reloads an unconsenting tab', () => {
  const f = watcherFixture(); f.activate();
  assert.equal(f.state.available, true); assert.equal(f.reloads, 0);
  f.watcher.refresh(); assert.equal(f.reloads, 1); f.watcher.dispose();
});
test('activation timeout unlocks retry; disposal removes listeners and timers', () => {
  const f = watcherFixture({ pending: true }); f.watcher.refresh();
  [...f.timers.values()].at(-1)();
  assert.equal(f.state.refreshing, false); assert.match(f.state.error, /try again/);
  f.watcher.dispose(); const before = f.checks;
  emit(f.win, 'online'); f.activate();
  assert.equal(f.checks, before); assert.equal(f.reloads, 0); assert.equal(f.timers.size, 0);
});
test('resume/reconnect checks are throttled, hidden and offline checks skipped', async () => {
  const f = watcherFixture(); await Promise.resolve();
  assert.equal(f.checks, 1); emit(f.win, 'online'); assert.equal(f.checks, 1);
  f.advance(); emit(f.win, 'pageshow'); await Promise.resolve(); assert.equal(f.checks, 2);
  f.advance(); f.doc.visibilityState = 'hidden'; emit(f.doc, 'visibilitychange'); assert.equal(f.checks, 2);
  f.doc.visibilityState = 'visible'; emit(f.doc, 'visibilitychange'); await Promise.resolve(); assert.equal(f.checks, 3);
  f.advance(); f.offline(); emit(f.win, 'online'); assert.equal(f.checks, 3); f.watcher.dispose();
});

test('failed update installs are visible and can be retried without reloading', async () => {
  const f = watcherFixture(); await Promise.resolve();
  f.registration.installing = f.worker; emit(f.registration, 'updatefound');
  f.worker.state = 'redundant'; emit(f.worker, 'statechange');
  assert.equal(f.state.available, false); assert.match(f.state.error, /could not be downloaded/);
  emit(f.win, 'focus'); assert.match(f.state.error, /could not be downloaded/);
  f.watcher.refresh(); await Promise.resolve();
  assert.equal(f.checks, 2); assert.equal(f.reloads, 0);
  f.install(); assert.equal(f.state.available, true); assert.equal(f.state.error, '');
  f.watcher.dispose();
});

test('update check failures are visible; an installed event need not have waiting set yet', async () => {
  const f = watcherFixture(); await Promise.resolve();
  f.registration.update = async () => { throw new Error('bad deployment'); };
  f.advance(); emit(f.win, 'focus'); await Promise.resolve();
  assert.match(f.state.error, /Could not check/);
  f.registration.update = async () => {};
  await f.watcher.refresh(); assert.equal(f.state.error, '', 'successful retry clears a transient check error');
  f.registration.installing = f.worker; emit(f.registration, 'updatefound');
  f.worker.state = 'installed'; emit(f.worker, 'statechange');
  assert.equal(f.state.available, true); assert.equal(f.state.error, '');
  f.watcher.dispose();
});

test('release IDs match across independent builds and change with shipped inputs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cs-build-id-'));
  try {
    for (const dir of ['src', 'public', 'dist', 'node_modules', 'test']) mkdirSync(path.join(root, dir));
    const write = (file, content) => writeFileSync(path.join(root, file), content);
    write('src/App.jsx', 'app'); write('public/sw-push.js', 'worker'); write('package-lock.json', '{}');
    const original = createBuildId(root);
    assert.equal(createBuildId(root), original);
    for (const file of ['dist/index.html', 'node_modules/cache.json', 'test/test.js']) write(file, 'unshipped');
    assert.equal(createBuildId(root), original, 'outputs and host dependencies do not affect identity');
    for (const file of ['src/App.jsx', 'public/sw-push.js', 'package-lock.json', 'vite.config.js']) {
      const before = createBuildId(root); write(file, 'changed');
      assert.notEqual(createBuildId(root), before, file);
    }
    assert.notEqual(createBuildId(root, { VITE_FEATURE: 'on' }), createBuildId(root, { VITE_FEATURE: 'off' }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const SOURCE = readFileSync(new URL('../public/sw-push.js', import.meta.url), 'utf8');
function workerFixture({ build = 'a', assets = ['/assets/app-a.js'] } = {}) {
  const handlers = new Map(), stores = new Map();
  const keyOf = (input) => new URL(typeof input === 'string' ? input : input.url, 'https://store.test').href;
  let network = async (request) => new Response(keyOf(request).endsWith('/')
    ? `<meta name="cs-build" content="${build}">` : 'asset', { headers: { 'Content-Type': keyOf(request).endsWith('/') ? 'text/html' : 'text/javascript' } });
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        match: async (input) => store.get(keyOf(input))?.clone(),
        put: async (input, value) => { store.set(keyOf(input), value.clone()); },
        keys: async () => [...store.keys()], delete: async (input) => store.delete(keyOf(input)),
        addAll: async (inputs) => { for (const input of inputs) { const res = await network(input); if (!res.ok) throw new Error('Bad precache response'); store.set(keyOf(input), res); } },
      };
    },
  };
  let skips = 0, claims = 0, shown, opened;
  const clients = { matchAll: async () => [], claim: async () => { claims++; }, openWindow: async (url) => { opened = url; } };
  const self = { location: new URL('https://store.test/sw-push.js'), clients,
    skipWaiting: async () => { skips++; }, registration: { showNotification: async (...args) => { shown = args; } },
    addEventListener: (type, fn) => handlers.set(type, fn) };
  class LocalRequest extends Request { constructor(input, init) { super(typeof input === 'string' ? keyOf(input) : input, init); } }
  const context = vm.createContext({ self, clients, caches, Request: LocalRequest, Response, Headers, URL, MessageChannel, setTimeout, clearTimeout, fetch: (...args) => network(...args) });
  vm.runInContext(SOURCE.replace("'__CS_BUILD_ID__'", JSON.stringify(build)).replace('/* __CS_PRECACHE__ */ []', JSON.stringify(assets)), context);
  return {
    caches, clients, stores, context, setNetwork(fn) { network = fn; },
    get skips() { return skips; }, get claims() { return claims; }, get shown() { return shown; }, get opened() { return opened; },
    async dispatch(type, extra = {}) { let work; handlers.get(type)({ ...extra, waitUntil(p) { work = p; }, respondWith(p) { work = p; } }); return await work; },
    request(path, { navigate = false, ...options } = {}) {
      const request = new LocalRequest(path, options);
      if (navigate) Object.defineProperty(request, 'mode', { value: 'navigate' });
      return this.dispatch('fetch', { request });
    },
  };
}

test('install precaches a matching shell and all chunks, but never skips waiting', async () => {
  const f = workerFixture(); await f.dispatch('install');
  const cache = await f.caches.open('cs-shell-a');
  assert.ok(await cache.match('/')); assert.ok(await cache.match('/assets/app-a.js')); assert.equal(f.skips, 0);
  await f.dispatch('message', { data: { type: 'SKIP_WAITING' } }); assert.equal(f.skips, 1);
});
test('partial or mixed deployments fail install and leave the old release usable', async () => {
  const f = workerFixture(); await f.dispatch('install');
  f.setNetwork(async () => new Response('<meta name="cs-build" content="wrong">', { headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(f.dispatch('install'), /different builds/);
  assert.match(await (await (await f.caches.open('cs-shell-a')).match('/')).text(), /content="a"/);
  f.setNetwork(async (request) => request.url.endsWith('/')
    ? new Response('<meta name="cs-build" content="a">', { headers: { 'Content-Type': 'text/html' } })
    : new Response('', { status: 404 }));
  await assert.rejects(f.dispatch('install'), /Bad precache/); assert.equal(f.skips, 0);
});
test('API navigations, private reads, mutations and other origins never enter a cache', async () => {
  const f = workerFixture();
  for (const path of ['/api/orders', '/api/auth/me', '/api/cart', '/api/profile', '/uploads/chat/a.png', 'https://elsewhere.test/assets/a.js']) {
    assert.equal(await f.request(path), undefined, path);
  }
  assert.equal(await f.request('/api/products', { headers: { Authorization: 'Bearer secret' } }), undefined);
  assert.equal(await f.request('/api/products', { method: 'POST' }), undefined);
  assert.equal(await f.request('/api/products', { navigate: true }), undefined);
  assert.equal(await f.request('/uploads/chat/a.png', { navigate: true }), undefined);
  assert.equal(f.stores.size, 0);
});
test('navigation uses its complete release, handles offline and 5xx, preserves 404', async () => {
  const f = workerFixture(); await f.dispatch('install');
  f.setNetwork(async () => new Response('<new release>', { headers: { 'Content-Type': 'text/html' } }));
  assert.match(await (await f.request('/products/1', { navigate: true })).text(), /content="a"/);
  f.setNetwork(async () => new Response('', { status: 502 }));
  assert.equal((await f.request('/products', { navigate: true })).status, 200);
  f.setNetwork(async () => { throw new Error('offline'); });
  assert.equal((await f.request('/products', { navigate: true })).status, 200);
  f.setNetwork(async () => new Response('', { status: 404 }));
  assert.equal((await f.request('/missing', { navigate: true })).status, 404);
});
test('anonymous catalog fallback is marked stale; private/no-store replies are excluded', async () => {
  const f = workerFixture(); f.setNetwork(async () => new Response('{"products":[]}', { headers: { 'Content-Type': 'application/json' } }));
  await f.request('/api/products');
  f.setNetwork(async () => new Response('', { status: 503 }));
  const fallback = await f.request('/api/products'); assert.equal(fallback.headers.get('X-CS-Offline'), '1');
  recordCatalogResponse('/products', fallback); assert.equal(hasOfflineCatalog(), true);
  recordCatalogResponse('/products', new Response('{}')); assert.equal(hasOfflineCatalog(), false);
  f.setNetwork(async () => new Response('private', { headers: { 'Cache-Control': 'private, no-store' } }));
  await f.request('/api/products/2');
  assert.equal(await (await f.caches.open('cs-public-catalog-a')).match('/api/products/2'), undefined);
  f.setNetwork(async () => { throw new Error('offline'); });
  assert.equal((await f.request('/api/products/2')).status, 503);
});
test('activation cleans only owned caches and retains live tabs’ old chunks', async () => {
  const f = workerFixture();
  for (const name of ['cs-shell-old', 'cs-shell-unused', 'cs-catalog-legacy', 'cs-media-legacy', 'unrelated', 'cs-push-meta']) await f.caches.open(name);
  f.clients.matchAll = async () => [{ postMessage(_data, ports) { ports[0].postMessage('old'); ports[0].close(); } }];
  await f.dispatch('activate');
  assert.deepEqual(await f.caches.keys(), ['cs-shell-old', 'unrelated', 'cs-push-meta']); assert.equal(f.claims, 1);
  const cache = await f.caches.open('cs-shell-old'); await cache.put('/assets/old.js', new Response('old chunk'));
  f.setNetwork(async () => { throw new Error('offline'); });
  assert.equal(await (await f.request('/assets/old.js')).text(), 'old chunk');
});
test('push works with JSON/text and clicks use exact same-origin destinations', async () => {
  const f = workerFixture();
  await f.dispatch('message', { data: { type: 'SET_STORE_NAME', storeName: 'Shop' } });
  await f.dispatch('push', { data: { json: () => ({ body: 'Ready' }) } });
  assert.equal(f.shown[0], 'Shop'); assert.equal(f.shown[1].icon, '/icon-192.png');
  await f.dispatch('push', { data: { json: () => { throw new Error(); }, text: () => 'Text' } });
  assert.equal(f.shown[1].body, 'Text');
  let focused = false;
  f.clients.matchAll = async () => [{ url: 'https://store.test/orders/10', focus() { focused = true; } }];
  await f.dispatch('notificationclick', { notification: { close() {}, data: { url: '/orders/1' } } });
  assert.equal(focused, false); assert.equal(f.opened, 'https://store.test/orders/1');
  await f.dispatch('notificationclick', { notification: { close() {}, data: { url: 'https://elsewhere.test/' } } });
  assert.equal(f.opened, 'https://store.test/');
});

test('catalog and media caches evict oldest entries at their limits', async () => {
  const f = workerFixture();
  f.setNetwork(async () => new Response('{}'));
  for (let i = 0; i < 102; i++) await f.request(`/api/products?page=${i}`);
  const catalog = await f.caches.open('cs-public-catalog-a');
  assert.equal((await catalog.keys()).length, 100);
  assert.equal(await catalog.match('/api/products?page=0'), undefined);
  for (let i = 0; i < 202; i++) await f.request(`/uploads/products/${i}.png`);
  const media = await f.caches.open('cs-media-a');
  assert.equal((await media.keys()).length, 200);
  assert.equal(await media.match('/uploads/products/0.png'), undefined);
});

test('manifest and app icons revalidate instead of staying cache-first forever', async () => {
  const f = workerFixture();
  f.setNetwork(async () => new Response('first identity'));
  await f.request('/manifest.json'); await f.request('/apple-touch-icon.png');
  f.setNetwork(async () => new Response('new identity'));
  assert.equal(await (await f.request('/manifest.json')).text(), 'new identity');
  assert.equal(await (await f.request('/apple-touch-icon.png')).text(), 'new identity');
});

test('cache write failures do not discard a successful catalog response', async () => {
  const f = workerFixture();
  const open = f.caches.open;
  f.caches.open = async (name) => ({ ...await open(name), put: async () => { throw new Error('QuotaExceededError'); } });
  f.setNetwork(async () => new Response('live data'));
  assert.equal(await (await f.request('/api/products')).text(), 'live data');
});
