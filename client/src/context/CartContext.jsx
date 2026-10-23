import { createCartLoader } from '../utils/cartLoader';
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../utils/api';
import { useAuth } from './AuthContext';
import { playSound } from '../utils/sounds';

const CartContext = createContext(null);

/**
 * "The cart changed underneath you — read it again."
 *
 * Exported so the one dispatcher and the one listener name it from the same
 * constant; a typo in a string literal would disconnect the two halves
 * silently, which is the failure `ASK_EVENT` in utils/askAssistant.js is
 * written the same way to avoid.
 */
export const CART_CHANGED = 'cs:cart-changed';

export function CartProvider({ children }) {
  const { user } = useAuth();
  const userIdRef = useRef(null);
  userIdRef.current = user?.id ?? null;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  /**
   * Why the cart is empty, when it is empty because something broke.
   *
   * The catch below has always emptied the list, which is correct — a stale
   * cart is worse than no cart — but it threw the reason away too, so a server
   * that was down and a buyer who had genuinely bought nothing produced byte
   * for byte the same screen: "Your cart is empty — browse products". Someone
   * whose lines had just vanished was told to go shopping. The cart page draws
   * a retry off this instead.
   */
  const [error, setError] = useState(null);
  /**
   * Whether the cart has been read at least once for this signed-in user.
   *
   * `items` starts as `[]`, which is indistinguishable from a cart that really
   * is empty — and Checkout redirects an empty cart to /cart. So a hard refresh
   * on /checkout, or any link straight to it, bounced to the cart page every
   * time: the redirect ran on mount, before the fetch it was supposed to be
   * reacting to had even been sent. It only appeared to work because the usual
   * route in is a click from /cart, where the provider is already populated.
   *
   * Set on settle, not on success — a cart that failed to load is also a cart
   * whose emptiness means nothing, and `error` is what says which happened.
   */
  const [hydrated, setHydrated] = useState(false);

  const loader = useRef(null);
  if (!loader.current) loader.current = createCartLoader({
    read: () => api.get('/orders/cart'),
    currentUserId: () => userIdRef.current,
    update: state => {
      if ('items' in state) setItems(state.items);
      if ('error' in state) setError(state.error);
      if ('hydrated' in state) setHydrated(state.hydrated);
      if ('loading' in state) setLoading(state.loading);
    },
  });
  const fetchCart = useCallback(() => loader.current(user?.id ?? null), [user]);

  useEffect(() => {
    fetchCart();
  }, [fetchCart]);

  /**
   * Somebody changed the cart without going through this context.
   *
   * There is exactly one such writer today and it is the assistant: its
   * `add_to_cart` / `remove_from_cart` tools write `cart_items` on the server
   * (server/services/ai/tools.js), so the first this browser hears of it is a
   * sentence in a chat bubble. Without this the buddy said "I have put 27 in
   * your cart" while the navbar badge went on showing the old number until the
   * next navigation — which reads as the assistant having lied, and is the one
   * failure that discredits a feature whose whole job is doing what it says.
   *
   * An event rather than exposing `fetchCart` through a prop or a ref, for the
   * reason `utils/askAssistant.js` gives about the other direction: the buddy
   * lives in the navbar and the writer is a network response inside it, and a
   * one-way "something changed, re-read it" is what a DOM event is. Anything
   * else that ever writes the cart out of band gets this for nothing.
   */
  useEffect(() => {
    const changed = () => { fetchCart(); };
    window.addEventListener(CART_CHANGED, changed);
    return () => window.removeEventListener(CART_CHANGED, changed);
  }, [fetchCart]);

  const addToCart = async (variantId, quantity = 1) => {
    await api.post('/orders/cart', { variant_id: variantId, quantity });
    // In the context, not the buttons: every add-to-cart surface (grid card,
    // detail page, wishlist) confirms with the same pop or none of them do.
    playSound('cart');
    // Same argument as the sound directly above, one step further: the
    // companion's walk to the cart is a reaction to the CART changing, not to
    // a particular button being pressed, and every add-to-cart surface should
    // get it or none of them should.
    window.dispatchEvent(new CustomEvent('cs:cart-add', { detail: { variantId } }));
    await fetchCart();
  };

  const updateQuantity = async (itemId, quantity) => {
    await api.put(`/orders/cart/${itemId}`, { quantity });
    await fetchCart();
  };

  const removeItem = async (itemId) => {
    // A 404 means the line was already gone — a stale list, a double click, or
    // a removal from another tab. That is the state this call was asking for,
    // so treat it as success and let the refetch below resync. Rethrowing
    // instead would skip fetchCart() and strand the row on screen, which is
    // the opposite of what the user just asked for.
    try {
      await api.delete(`/orders/cart/${itemId}`);
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    await fetchCart();
  };

  const total = items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <CartContext.Provider value={{ items, loading, error, hydrated, addToCart, updateQuantity, removeItem, fetchCart, total, count }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
