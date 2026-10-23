import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { registerServiceWorker } from '../utils/push';
import { watchPwaUpdates } from '../utils/pwa';

export default function PwaUpdatePrompt() {
  const [state, setState] = useState({ available: false, refreshing: false, error: '' });
  const [dismissed, setDismissed] = useState(false);
  const watcher = useRef(null);
  useEffect(() => {
    let disposed = false;
    let registering = false;
    const start = async () => {
      if (disposed || registering || watcher.current) return;
      registering = true;
      const registration = await registerServiceWorker();
      registering = false;
      if (!registration || disposed) return;
      watcher.current = watchPwaUpdates(registration, setState);
    };
    start();
    // A first registration attempted during an outage can fail. Reconnect
    // must retry it too, not only update checks on an existing registration.
    window.addEventListener('online', start);
    window.addEventListener('pageshow', start);
    return () => {
      disposed = true;
      window.removeEventListener('online', start);
      window.removeEventListener('pageshow', start);
      watcher.current?.dispose();
      watcher.current = null;
    };
  }, []);
  useEffect(() => { setDismissed(false); }, [state.available, state.error, state.revision]);
  if ((!state.available && !state.error) || dismissed) return null;
  return (
    <section className="pwa-update" aria-label="Store update">
      <RefreshCw size={20} aria-hidden="true" />
      <div className="pwa-update-copy" role="status" aria-live="polite">
        <strong>{state.available ? 'A new version of the store is ready' : 'The store update needs another try'}</strong>
        <p>{state.error || 'Refresh to update. Finish any unsaved changes first.'}</p>
      </div>
      <div className="pwa-update-actions">
        <button type="button" className="glass-btn glass-btn-primary" disabled={state.refreshing}
          onClick={() => watcher.current?.refresh()}>
          {state.refreshing ? 'Updating…' : state.available ? 'Refresh now' : 'Try again'}
        </button>
        <button type="button" className="glass-btn" disabled={state.refreshing}
          onClick={() => setDismissed(true)}>Later</button>
      </div>
    </section>
  );
}
