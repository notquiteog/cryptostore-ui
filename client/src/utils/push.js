import { api } from './api';

let swRegistration = null;
let registrationPromise = null;

/**
 * Register the one service worker. Called on every load (App.jsx), not only
 * when a buyer opts into push: the worker is also the offline shell, and a
 * shell that only exists for people who wanted notifications is no shell.
 *
 * In development the shell is registered only when asked for
 * (`localStorage['cs.sw.dev'] = '1'`): a cache-first shell in front of Vite's
 * module server is a debugging session nobody wants, and the push opt-in
 * below still registers on its own.
 */
export async function registerServiceWorker({ force = false } = {}) {
  if (!('serviceWorker' in navigator)) return null;
  if (!force && !import.meta.env.PROD) {
    let wanted = false;
    try { wanted = localStorage.getItem('cs.sw.dev') === '1'; } catch { /* private mode */ }
    if (!wanted) return null;
  }
  if (swRegistration) return swRegistration;
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker.register('/sw-push.js', {
      scope: '/', updateViaCache: 'none',
    }).then((registration) => {
      swRegistration = registration;
      return registration;
    }).catch((err) => {
      console.warn('SW registration failed:', err);
      return null;
    }).finally(() => { registrationPromise = null; });
  }
  return registrationPromise;
}

export async function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null;
  }
  if (swRegistration) return swRegistration;
  return registerServiceWorker({ force: true });
}

export async function subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Your browser does not support push notifications.');
  }

  if (!swRegistration) {
    await initPushNotifications();
  }
  if (!swRegistration) {
    throw new Error('Service worker failed to register. Try refreshing the page.');
  }

  // register() resolves before the first worker activates. PushManager
  // requires an active worker, so first-time opt-in must wait for readiness.
  await navigator.serviceWorker.ready;

  let publicKey;
  try {
    const data = await api.get('/push/vapid-key');
    publicKey = data?.publicKey;
  } catch {
    throw new Error('Push notifications are not configured on this server. Contact the administrator.');
  }
  if (!publicKey) {
    throw new Error('Push notifications are not configured on this server. Contact the administrator.');
  }

  let subscription;
  try {
    subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  } catch (err) {
    console.warn('Push subscribe failed:', err);
    if (err.name === 'NotAllowedError') {
      throw new Error('Notification permission was denied. Enable notifications for this site in your browser settings.');
    }
    throw new Error(`Subscription failed: ${err.message}`);
  }

  try {
    const json = subscription.toJSON();
    await api.post('/push/subscribe', {
      endpoint: json.endpoint,
      keys: json.keys,
    });
  } catch (err) {
    throw new Error(`Could not save subscription to server: ${err.message}`);
  }

  return true;
}

export async function unsubscribePush() {
  if (!swRegistration) await initPushNotifications();
  if (!swRegistration) return;
  try {
    const subscription = await swRegistration.pushManager.getSubscription();
    if (subscription) {
      await api.post('/push/unsubscribe', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
  } catch (err) {
    console.warn('Push unsubscribe failed:', err);
  }
}

export async function isPushSubscribed() {
  if (!swRegistration) {
    await initPushNotifications();
  }
  if (!swRegistration) return false;
  try {
    const subscription = await swRegistration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
