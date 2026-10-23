import { useEffect, useState } from 'react';

function remainingMs(endsAt) {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - Date.now());
}

/**
 * Time left until `endsAt`, re-read once a second.
 *
 * Returns `null` when there is no deadline or the date is unparseable, so a
 * caller can render nothing without first having to validate the input, and
 * `{ total: 0, expired: true }` once the deadline passes. The interval clears
 * itself at zero rather than ticking on forever behind a static "00:00:00".
 *
 * Deliberately not driven by the difference alone: a tab that sleeps for ten
 * minutes wakes up and recomputes from the clock, so the display cannot drift.
 */
export default function useCountdown(endsAt) {
  const [left, setLeft] = useState(() => remainingMs(endsAt));

  useEffect(() => {
    setLeft(remainingMs(endsAt));
    if (!endsAt) return undefined;
    const id = setInterval(() => {
      const next = remainingMs(endsAt);
      setLeft(next);
      if (next === null || next <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  if (left === null) return null;

  const totalSeconds = Math.floor(left / 1000);
  return {
    total: left,
    expired: left <= 0,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}
