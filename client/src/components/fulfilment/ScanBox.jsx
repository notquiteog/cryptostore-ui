import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ScanBarcode } from 'lucide-react';
import { api } from '../../utils/api';
import { playSound } from '../../utils/sounds';
import { useAuth } from '../../context/AuthContext';
import { adminCapabilities } from '../../utils/adminPermissions';

/**
 * Where a scanned box tag goes, decided once for every fulfilment page.
 *
 * `GET /fulfilment/lookup` says which order the code names, which box if the
 * tag carried one, and which STATION the order is at — derived from picked
 * and outstanding units the same way the queues derive it, so a scan and the
 * desk's list can never disagree. This turns that answer into a navigation,
 * gated on what the scanner's own grants can open: a packer who scans a
 * carton that is already at the desk is told so rather than sent to a 403.
 */
export function useScanRouter() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const caps = adminCapabilities(user);

  return useCallback(async (code) => {
    const clean = String(code || '').trim();
    if (!clean) return;
    try {
      const hit = await api.get(`/fulfilment/lookup?code=${encodeURIComponent(clean)}`);
      const ref = hit.order.uuid.split('-')[0].toUpperCase();
      const boxWord = hit.box ? ` · box ${hit.box.box_number}` : hit.box_missing ? ` · no box ${hit.box_missing} on it` : '';
      playSound('tick');
      switch (hit.stage) {
        case 'pack':
          if (caps.pickOrders) navigate(`/admin/pack/${hit.order.id}`);
          else toast(`${ref}${boxWord} is still on the packing bench.`);
          return;
        case 'ship':
          if (caps.updateOrderStatus || caps.manageTracking) {
            navigate(`/admin/ship?order=${hit.order.id}${hit.box ? `&box=${hit.box.box_number}` : ''}`);
          } else {
            toast.success(`${ref}${boxWord} is packed and waiting at the Ship desk.`);
          }
          return;
        case 'shipped':
        case 'delivered':
          toast.success(`${ref}${boxWord} already ${hit.stage}${hit.box?.shipped_at ? ` on ${new Date(hit.box.shipped_at).toLocaleDateString()}` : ''}.`);
          return;
        case 'unpaid':
          toast(`${ref} has not been paid yet — nothing to pack.`);
          return;
        default:
          toast(`${ref} is ${hit.order.status} — nothing left to do at the bench or the desk.`);
      }
    } catch (err) {
      playSound('error');
      toast.error(err.message || 'Nothing matches that code');
    }
  }, [navigate, caps.pickOrders, caps.updateOrderStatus, caps.manageTracking]);
}

/**
 * A keyboard-wedge scanner, listened for on the whole page.
 *
 * A USB or Bluetooth barcode scanner is a keyboard that types very fast and
 * presses Enter. This watches for exactly that — a run of characters arriving
 * within a few milliseconds of each other, ended by Enter, while no text field
 * has focus — and hands the run to `onScan`. Human typing is far slower, and
 * a human typing into a field is not on this path at all, so the two never
 * collide. The bench's own single-key shortcuts (space, j, k, digits) are
 * unaffected: a scan is many keys in under a second, and a shortcut is one.
 */
export function useScanWedge(onScan, { enabled = true, minLength = 6, gapMs = 50 } = {}) {
  const buf = useRef('');
  const last = useRef(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const now = performance.now();
      if (now - last.current > gapMs) buf.current = '';
      last.current = now;
      if (e.key === 'Enter') {
        if (buf.current.length >= minLength) {
          e.preventDefault();
          onScan(buf.current);
        }
        buf.current = '';
        return;
      }
      if (e.key.length === 1) buf.current += e.key;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onScan, enabled, minLength, gapMs]);
}

/**
 * The scan field: a box tag or an order reference, typed or scanned, Enter.
 *
 * It exists because a scanner needs somewhere to land its keystrokes when a
 * text field is focused (the wedge above only listens when none is), and
 * because a store without a scanner still has a dispatcher reading a tag off
 * a carton and typing it. `autoFocus` is deliberately NOT set: the desk has
 * other fields, and stealing focus on load would send every scan into
 * whichever tracking input was last used.
 */
export default function ScanBox({ placeholder = 'Scan a box tag or type an order ref' }) {
  const route = useScanRouter();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await route(value);
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="scanbox" onSubmit={submit} role="search" aria-label="Find an order or box by its tag">
      <ScanBarcode size={15} aria-hidden="true" className="scanbox-icon" />
      <input
        className="scanbox-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label="Box tag or order reference"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck="false"
        disabled={busy}
      />
      <kbd className="scanbox-kbd" aria-hidden="true">↵</kbd>
    </form>
  );
}
