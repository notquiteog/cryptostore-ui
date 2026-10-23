import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

/**
 * "Somebody else just changed a setting you are looking at."
 *
 * ── Why hearing beats being refused ─────────────────────────────────────────
 *
 * `PUT /api/settings` already refuses a save whose baseline has moved, so
 * nothing is lost without this. But being refused is a correct outcome and a
 * wasted one: the operator has read the page, typed their change, pressed Save,
 * and is told to start over. This is the same fact arriving at the moment it
 * becomes true, so the form is never stale in the first place.
 *
 * ── What comes over the wire, and what does not ─────────────────────────────
 *
 * Key names and who changed them. Never values — `chatService.announceSettingChange`
 * explains why at length, and the short version is that a broadcast carrying
 * values would be a second way to read the settings table with none of
 * `settingsKeyPermission` in front of it. So this hook reports WHICH keys went
 * stale and the page decides what to do about it; it cannot show the new value
 * and does not try.
 *
 * ── Its own connection, and why that is not wasteful ────────────────────────
 *
 * The live chat widget opens a socket when it opens; this opens one when a
 * settings page mounts. They are separate because their lifetimes are: closing
 * the chat must not stop a settings page hearing, and leaving a settings page
 * must not close a support conversation. socket.io multiplexes over one
 * transport per namespace anyway, so the second `io()` on the same origin is
 * cheap — and a shared singleton would be a module deciding when to disconnect
 * on behalf of two features that disagree about it.
 *
 * ── Silent on failure ───────────────────────────────────────────────────────
 *
 * A store with no socket reachable, a proxy that drops websockets, a session
 * without the staff role: all of them fall back to the behaviour that existed
 * before this hook, which is the 409. Nothing here is load-bearing, so nothing
 * here reports an error to somebody trying to change a setting.
 *
 * @param {string[]} keys  the keys this page is holding
 * @returns {{stale: string[], by: string|null, clear: () => void}}
 */
export function useSettingsWatch(keys) {
  const [stale, setStale] = useState([]);
  const [by, setBy] = useState(null);
  // The page's key list changes identity on every render; the socket must not.
  const watched = useRef(keys);
  watched.current = keys;

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return undefined;

    let socket;
    try {
      socket = io({ path: '/socket.io', auth: { token }, transports: ['websocket', 'polling'] });
    } catch {
      return undefined;
    }

    socket.on('settings:changed', (msg) => {
      const changed = Array.isArray(msg?.keys) ? msg.keys : [];
      // Only the keys THIS page is holding. A theme publish should not put a
      // warning on the rate-limits form, and a page told about every settings
      // write in the shop is a page whose warning nobody reads.
      const mine = changed.filter((k) => watched.current.includes(k));
      if (!mine.length) return;
      setBy(msg?.by || null);
      setStale((prev) => [...new Set([...prev, ...mine])]);
    });

    // Nothing is emitted from here. The staff room is joined by the server on
    // connection, because "I am looking at the admin panel" has no opt-in step
    // and a page that had to ask is a page somebody forgets to make ask.
    return () => { socket.close(); };
  }, []);

  return { stale, by, clear: () => { setStale([]); setBy(null); } };
}

export default useSettingsWatch;
