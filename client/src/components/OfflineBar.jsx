import { useEffect, useState, useSyncExternalStore } from 'react';
import { WifiOff } from 'lucide-react';
import { hasOfflineCatalog, subscribeOfflineCatalog } from '../utils/offlineCatalog';

/**
 * Says so when the connection is gone.
 *
 * The service worker keeps the shell and the catalog (public/sw-push.js), so
 * a buyer who loses their connection keeps a working store — but a store
 * that keeps working while its prices and stock are hours old must SAY it is
 * doing that. This bar is that sentence. It appears the moment the browser
 * reports offline and goes the moment it reports back; nothing else on the
 * page changes, because the cached shelf is still the right thing to show.
 *
 * A cached API fallback also shows this bar when the browser has a network
 * connection but the store is unreachable. utils/offlineCatalog.js tracks
 * those replies until the same requests succeed again.
 */
export default function OfflineBar() {
  const stale = useSyncExternalStore(subscribeOfflineCatalog, hasOfflineCatalog, () => false);
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (!offline && !stale) return null;
  return (
    <div className="offline-bar" role="status">
      <WifiOff size={14} aria-hidden="true" />
      <span>
        <b>{offline ? 'You’re offline.' : 'Showing saved store details.'}</b> Showing the store as this device last saw it — prices and stock may have
        changed, and checkout needs a connection.
      </span>
    </div>
  );
}
