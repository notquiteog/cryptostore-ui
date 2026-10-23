import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart, Trash2, Minus, Plus, ArrowRight, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCart } from '../context/CartContext';
import NavPopover from './NavPopover';

const money = (n) => `$${Number(n).toFixed(2)}`;

/**
 * The hover cart: a floating, scrollable, EDITABLE preview under the navbar's
 * cart icon, so quantity fixes and removals don't cost a page navigation.
 * Rides the shared NavPopover engine (hover-intent, focus-within, Escape,
 * inert-while-closed, bare link on touch pointers).
 */
export default function MiniCart() {
  const { items, count, total, updateQuantity, removeItem } = useCart();
  const navigate = useNavigate();

  // The API refuses impossible edits ("Not enough stock") with a 400 that the
  // full cart page surfaces in its own layout; here the surface is a floating
  // panel, so the refusal has to become a toast or the click just silently
  // does nothing and the panel looks broken.
  const safely = async (fn) => {
    try {
      await fn();
    } catch (err) {
      toast.error(err?.message || 'Cart update failed');
    }
  };

  const trigger = (
    // `data-nav` names this icon for anything that has to FIND it on the bar
    // rather than style it — today the companion, which walks over and looks
    // at the cart when something lands in it (useCompanionRoam.escortTo).
    // A selector built from the title attribute would break the day somebody
    // translates it.
    <Link to="/cart" className="nav-icon-link" data-nav="cart" title="Cart">
      <ShoppingCart size={19} />
      {count > 0 && <span className="cart-badge">{count}</span>}
    </Link>
  );

  return (
    <NavPopover trigger={trigger} ariaLabel="Cart preview" panelClassName="minicart" openOn="hover">
      {({ close }) => (
        <>
          <div className="nav-pop-head">
            <span className="nav-pop-title">Your cart</span>
            <span className="nav-pop-count">{count} item{count === 1 ? '' : 's'}</span>
          </div>

          {items.length === 0 ? (
            <div className="nav-pop-empty">
              <Package size={20} />
              <span>Nothing here yet — it keeps whatever you add.</span>
            </div>
          ) : (
            <>
              <ul className="nav-pop-list minicart-list">
                {items.map((item) => (
                  <li key={item.id} className="minicart-row">
                    {item.image
                      ? <img src={item.image} alt="" className="minicart-img" loading="lazy" />
                      : <span className="minicart-img minicart-img-empty"><Package size={16} /></span>}
                    <div className="minicart-row-main">
                      <Link to={`/products/${item.group_id}`} className="minicart-name" onClick={close}>
                        {item.product_name}
                      </Link>
                      <span className="minicart-variant">{item.variant_name}</span>
                      <div className="qty-stepper minicart-stepper">
                        <button
                          type="button"
                          onClick={() => safely(() => updateQuantity(item.id, item.quantity - 1))}
                          disabled={item.quantity <= 1}
                          aria-label={`Decrease quantity of ${item.product_name}`}
                        >
                          <Minus size={12} />
                        </button>
                        <span className="qty-value">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => safely(() => updateQuantity(item.id, item.quantity + 1))}
                          aria-label={`Increase quantity of ${item.product_name}`}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="minicart-row-side">
                      <span className="minicart-line-total">{money(Number(item.price) * item.quantity)}</span>
                      <button
                        type="button"
                        className="minicart-remove"
                        onClick={() => safely(() => removeItem(item.id))}
                        aria-label={`Remove ${item.product_name} from cart`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="minicart-subtotal">
                <span>Subtotal</span>
                <span className="minicart-subtotal-value">{money(total)}</span>
              </div>
              <div className="nav-pop-foot">
                <button type="button" className="glass-btn glass-btn-sm" onClick={() => { close(); navigate('/cart'); }}>
                  View cart
                </button>
                <button type="button" className="glass-btn glass-btn-sm glass-btn-primary" onClick={() => { close(); navigate('/checkout'); }}>
                  Checkout <ArrowRight size={13} />
                </button>
              </div>
            </>
          )}
        </>
      )}
    </NavPopover>
  );
}
