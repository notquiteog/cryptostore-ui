import { useEffect, useState } from 'react';
import { api } from '../utils/api';

// Keep the request key beside its answer. A previous rail's quote must never
// briefly enable Place order while React starts the next request.
export default function useCartQuote(items, { paymentMethod = '', couponCode = '', voucherCode = '', useCredit = false, enabled = true } = {}) {
  const key = JSON.stringify([items.map(i => [i.variant_id, i.quantity, i.price]), paymentMethod, couponCode, voucherCode, useCredit]);
  const [answer, setAnswer] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const timer = setTimeout(() => {
      api.post('/orders/cart/quote', { payment_method: paymentMethod, coupon_code: couponCode, voucher_code: voucherCode, use_store_credit: useCredit })
        .then(data => { if (live) setAnswer({ key, data }); })
        .catch(err => { if (live) setAnswer({ key, error: err.message }); });
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [key, enabled, attempt]);
  return { data: answer?.data, ready: answer?.key === key && !!answer?.data,
    error: answer?.key === key ? answer.error : null,
    retry: () => { setAnswer(null); setAttempt(n => n + 1); } };
}
