import { PauseCircle } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

/**
 * What a buyer is told when the operator left the message blank.
 *
 * The same sentence `server/utils/storePause.js` answers with, kept in step
 * by hand: the bar is drawn from the public settings payload before any
 * request is refused, so it cannot wait for the server to say it.
 */
export const STORE_PAUSED_DEFAULT = 'The store is not taking orders right now.';

/**
 * The operator's pause notice, or the default — one place decides the
 * wording, so the bar, the cart and the checkout cannot each print a
 * different sentence about the same closed till.
 */
export function pausedMessage(settings) {
  return String(settings?.store_paused_message || '').trim() || STORE_PAUSED_DEFAULT;
}

/** Is the till shut? Read the way the server reads it: only an exact 'true'. */
export function storePaused(settings) {
  return settings?.store_paused === 'true';
}

/**
 * Says so when the operator has paused new orders.
 *
 * Modelled on OfflineBar: one line under the navbar, present only while the
 * condition holds, changing nothing else on the page. That last part is the
 * point. A paused store is still a store — the catalogue, the cart, the
 * order history, support and disputes all keep working, on the web and on
 * the bots — and the one thing that is closed is the till. A bar that said
 * "closed" and left it at that would send buyers away from everything that
 * still works; this one says what is closed and, by implication, what is not.
 *
 * Reads the public settings payload (`store_paused`, `store_paused_message`)
 * rather than waiting for a refused checkout, because the buyer should learn
 * this on the product page, not after filling in an address. The server still
 * refuses on its own (`orderController.createOrder`), so a stale payload that
 * says "open" costs the buyer a 423 at the button, never an order.
 */
export default function StorePausedBar() {
  const { settings } = useTheme();
  if (!storePaused(settings)) return null;
  return (
    <div className="store-paused-bar" role="status">
      <PauseCircle size={14} aria-hidden="true" />
      <span>
        <b>Not taking new orders right now.</b> {pausedMessage(settings)} You can still browse,
        keep a cart, and follow orders you have already placed.
      </span>
    </div>
  );
}
