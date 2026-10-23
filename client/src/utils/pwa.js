// Kept independent of React and push permissions: updating the store should
// work in a normal browser tab as well as an installed mobile/desktop app.
export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const CHECK_INTERVAL = 60 * 1000;
const CHECK_THROTTLE = 60 * 1000;
const CHECK_ERROR = 'Could not check for updates. Your current version is still available. Please try again.';

export function watchPwaUpdates(registration, onChange, {
  sw = navigator.serviceWorker, win = window, doc = document,
  online = () => navigator.onLine !== false, reload = () => window.location.reload(),
  now = () => Date.now(), buildId = BUILD_ID,
} = {}) {
  let waiting = null;
  let changed = false;
  let refreshing = false;
  let reloaded = false;
  let stopped = false;
  let lastCheck = -Infinity;
  let checking = false;
  let timer;
  let error = '';
  let revision = 0;
  let previousController = sw.controller;
  const observed = new Map();
  const publish = (nextError) => {
    if (nextError !== undefined) error = nextError;
    if (!stopped) onChange({ available: !!waiting || changed, refreshing, error, revision });
  };
  const reloadOnce = () => {
    if (reloaded || stopped) return;
    reloaded = true;
    win.clearTimeout(timer);
    reload();
  };
  const inspect = () => {
    waiting = registration.waiting;
    publish();
  };
  const observe = () => {
    const worker = registration.installing;
    if (!worker || observed.has(worker)) return;
    revision++;
    let installed = false;
    const statechange = () => {
      if (worker.state === 'installed') {
        installed = true;
        error = '';
        // The installed event can arrive before registration.waiting is set.
        waiting = registration.waiting || (sw.controller ? worker : null);
        publish();
      } else if (worker.state === 'redundant') {
        waiting = registration.waiting;
        if (!installed && sw.controller && !waiting) publish('The update could not be downloaded. Your current version is still available. Please try again.');
        worker.removeEventListener('statechange', statechange);
        observed.delete(worker);
      }
    };
    observed.set(worker, statechange);
    worker.addEventListener('statechange', statechange);
    statechange();
  };
  const controllerchange = () => {
    // First installation claims the page too; that is not an update.
    if (previousController && previousController !== sw.controller) changed = true;
    previousController = sw.controller;
    waiting = registration.waiting;
    if (refreshing && changed) reloadOnce();
    else publish(); // Another tab updated: leave this tab's form alone.
  };
  const message = (event) => {
    if (event.data?.type === 'GET_CLIENT_BUILD') event.ports?.[0]?.postMessage(buildId);
  };
  const check = async (force = false) => {
    if (stopped || doc.visibilityState === 'hidden' || !online() || checking) return;
    inspect();
    if (force !== true && now() - lastCheck < CHECK_THROTTLE) return;
    lastCheck = now();
    checking = true;
    try {
      await registration.update();
      if (error === CHECK_ERROR) publish('');
    }
    catch {
      if (sw.controller && online()) publish(CHECK_ERROR);
    }
    finally { checking = false; }
  };
  sw.addEventListener('controllerchange', controllerchange);
  sw.addEventListener('message', message);
  registration.addEventListener('updatefound', observe);
  win.addEventListener('online', check);
  win.addEventListener('pageshow', check);
  win.addEventListener('focus', check);
  doc.addEventListener('visibilitychange', check);
  const interval = win.setInterval(check, CHECK_INTERVAL);
  observe();
  inspect();
  check();

  return {
    refresh() {
      if (refreshing || stopped) return;
      waiting = registration.waiting;
      if (!waiting && changed) return reloadOnce();
      if (!waiting) return check(true);
      refreshing = true;
      publish();
      // Do not reload before activation, and do not leave a disabled button
      // forever if a worker dies or activation fails. The user can retry.
      timer = win.setTimeout(() => {
        refreshing = false;
        publish('The update could not finish. Please try again.');
      }, 15000);
      try { waiting.postMessage({ type: 'SKIP_WAITING' }); }
      catch {
        win.clearTimeout(timer);
        refreshing = false;
        publish('The update could not finish. Please try again.');
      }
    },
    dispose() {
      stopped = true;
      win.clearInterval(interval);
      win.clearTimeout(timer);
      registration.removeEventListener('updatefound', observe);
      sw.removeEventListener('controllerchange', controllerchange);
      sw.removeEventListener('message', message);
      win.removeEventListener('online', check);
      win.removeEventListener('pageshow', check);
      win.removeEventListener('focus', check);
      doc.removeEventListener('visibilitychange', check);
      for (const [worker, listener] of observed) worker.removeEventListener('statechange', listener);
    },
  };
}
