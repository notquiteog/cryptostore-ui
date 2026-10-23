import { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import { shouldPollMediaJobs, nextPollDelay, feedHasActiveJobs, POLL_ACTIVE_MS } from '../utils/mediaJobsPolling';

/**
 * One poll per product editor, feeding every media slot on the page.
 *
 * ── Why the page polls and the slots do not ─────────────────────────────────
 *
 * `MediaSlots` can poll for itself, and did: one request per slot, per tick.
 * A 268-variant product therefore opened with ~290 requests and asked again
 * for every slot every ten seconds, which overran the per-device global rate
 * limiter on the second page load — for a manager who held every grant the
 * page needs, so no permission fix could help. This hook asks once, for the
 * whole product (`/products/media/group/:id/feed`, keyed per owner), and the
 * page hands each slot its own entry. The cadence, the stop-on-refusal and
 * the back-off are the same tested rules the lone slot uses
 * (utils/mediaJobsPolling.js).
 *
 * `startedAt` rides with every answer so a slot can tell whether the feed was
 * read before or after its own last upload, delete or reorder — the same
 * "was this answer older than my change" guard the per-slot poll kept with a
 * revision counter, which a shared request cannot carry per slot.
 *
 * @param {{ groupId?: number|null, canManage: boolean, disabled?: boolean }} view
 * @returns {{ feed: null|{ owners: object, startedAt: number }, error: string, refresh: () => void }}
 *   `feed` is null until the first answer; `refresh` asks again now (after
 *   an upload or a cancel), which is also what restarts a stopped poll.
 */
export function useMediaJobsFeed({ groupId, canManage, disabled = false }) {
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!shouldPollMediaJobs({ ownerId: groupId, disabled, canManage })) return undefined;
    let active = true, timer;
    let lastDelay = POLL_ACTIVE_MS;
    const controller = new AbortController();
    const poll = async () => {
      const startedAt = Date.now();
      let next;
      try {
        const owners = await api.get(`/products/media/group/${groupId}/feed`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!active) return;
        setFeed({ owners: owners || {}, startedAt });
        setError('');
        next = nextPollDelay({ ok: true, hasActiveJobs: feedHasActiveJobs(owners) });
      } catch (err) {
        if (!active) return;
        next = nextPollDelay({ ok: false, status: err?.status ?? null, previousDelay: lastDelay });
        setError(next == null
          ? 'Encoding progress is not available to your account.'
          : 'Progress is temporarily unavailable. Your uploads stay queued; reconnecting…');
      }
      if (!active || next == null) return;
      lastDelay = next;
      timer = setTimeout(poll, next);
    };
    poll();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [groupId, canManage, disabled, tick]);

  return { feed, error, refresh };
}
