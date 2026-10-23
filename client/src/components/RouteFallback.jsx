import { useEffect, useState } from 'react';
import ProgressBar from './ProgressBar';

/**
 * What a route shows while its code is still arriving.
 *
 * ── Why it renders nothing at first ────────────────────────────────────────
 *
 * Routes are code-split (see App.jsx), so every first visit to a page fetches
 * a chunk. On a warm cache or a local dev server that takes a handful of
 * milliseconds — and a Suspense fallback shown for eight milliseconds is not
 * information, it is a flash of a progress bar on every navigation, which
 * reads as the app stuttering rather than as the app loading.
 *
 * So the bar waits. Below the delay the page simply appears, exactly as it did
 * when everything shipped in one bundle; above it — a cold cache, a slow link,
 * and on this project's target deployments that means Tor — the person is told
 * that something is happening rather than looking at a shell with a hole in it.
 *
 * 160ms is the usual floor for "this felt instant". It is deliberately shorter
 * than the ~250ms where a person starts to suspect a click did not register.
 *
 * The timer is cleared on unmount, so a chunk that lands before the delay
 * elapses never schedules a state update into a component that is already gone.
 */
const SHOW_AFTER_MS = 160;

export default function RouteFallback({ label = 'Loading…' }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setShow(true), SHOW_AFTER_MS);
    return () => clearTimeout(id);
  }, []);

  if (!show) return null;
  // Padded rather than bare: this stands in for a page, and a progress bar
  // jammed against the navbar looks like part of the shell rather than like
  // the page that is coming.
  return (
    <div className="route-fallback" style={{ padding: 'var(--sp-10) var(--sp-6)' }}>
      <ProgressBar label={label} />
    </div>
  );
}
