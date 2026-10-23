import { DEFAULT_THEME } from '../client/src/theme/defaults.js';

// Invented display fixtures. No database, credentials, or production API.
export const products = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  name: ['Everyday essentials', 'The signature collection', 'A fresh perspective', 'The weekend edit'][i % 4],
  category: ['Essentials', 'Collections', 'Lifestyle', 'Accessories'][i % 4],
  description: 'Considered details. Made for your everyday. Synthetic UI demo product.',
  active: true, images: [], tags: [], review_count: 12, average_rating: 4.8,
  featured_reason: 'bestseller',
  variants: [{ id: i + 1, name: 'Standard', price: 45 + i * 12, quantity: 24, active: true, tiers: [], images: [] }],
}));
const admin = { id: 1, username: 'demo', role: 'admin', permissions: [], balance: 0 };

export function demoApi() {
  let settings = {
    ...DEFAULT_THEME, store_name: 'CryptoStore UI Demo',
    allow_guest_browsing: 'true', age_gate_enabled: 'false', onboarding_enabled: 'false',
  };
  let revision = 1;
  let cart = [];
  const wishlist = new Set();
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/socket.io')) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Realtime chat is unavailable in the UI demo.' }));
      return;
    }
    if (!url.pathname.startsWith('/api/')) return next();
    const endpoint = url.pathname.slice(4);
    const method = req.method || 'GET';
    const send = (body, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      let body = {};
      if (!['GET', 'HEAD'].includes(method)) {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 1_000_000) return send({ error: 'Demo request too large' }, 413);
        }
        if (raw) body = JSON.parse(raw);
      }
      if (endpoint === '/auth/pow') return send({ bits: 0 });
      if (endpoint === '/auth/login' && method === 'POST') return send({ token: 'synthetic-ui-demo', user: admin });
      if (endpoint === '/auth/me') return send(admin);
      if (endpoint === '/auth/logout') return send({ success: true });
      if (endpoint === '/settings/theme') {
        if (method === 'PUT') { settings = { ...settings, ...body.changes }; revision++; }
        return send({ settings, revision, versions: [] });
      }
      if (endpoint === '/settings/home-promises') return send({ enabled: false });
      if (endpoint === '/settings/mirrors') return send({ mirrors: [] });
      if ((endpoint === '/settings/public' || endpoint === '/settings') && method === 'GET') return send(settings);
      if (endpoint === '/ai/status') return send({ enabled: false });
      if (endpoint === '/products/categories') return send([...new Set(products.map(p => p.category))]);
      if (['/products/brands', '/products/tags', '/flash-sales/active', '/moderation/restock', '/moderation/price-watch'].includes(endpoint)) return send([]);
      if (endpoint === '/products/featured') return send(products);
      if (endpoint === '/products') {
        let list = products.filter(p =>
          (!url.searchParams.get('category') || p.category === url.searchParams.get('category')) &&
          (!url.searchParams.get('search') || p.name.toLowerCase().includes(url.searchParams.get('search').toLowerCase())));
        const sort = url.searchParams.get('sort');
        if (sort === 'price_asc' || sort === 'price_desc') list = [...list].sort((a, b) => (a.variants[0].price - b.variants[0].price) * (sort === 'price_desc' ? -1 : 1));
        const limit = Math.max(1, Number(url.searchParams.get('limit')) || 24);
        const offset = ((Number(url.searchParams.get('page')) || 1) - 1) * limit;
        return send({ products: list.slice(offset, offset + limit), total: list.length });
      }
      if (/^\/products\/\d+$/.test(endpoint)) {
        const product = products.find(p => p.id === Number(endpoint.split('/').pop()));
        return send(product || { error: 'Demo product not found' }, product ? 200 : 404);
      }
      if (/^\/products\/\d+\/also-bought$/.test(endpoint)) return send([]);
      if (endpoint === '/reviews/recent') return send({ enabled: false });
      if (/^\/reviews\/\d+$/.test(endpoint)) return send({ reviews: [], total: 0 });
      if (endpoint === '/wishlist/ids') return send([...wishlist]);
      if (endpoint === '/wishlist' && method === 'POST') { wishlist.add(body.variant_id); return send({ success: true }); }
      if (/^\/wishlist\/\d+$/.test(endpoint) && method === 'DELETE') { wishlist.delete(Number(endpoint.split('/').pop())); return send({ success: true }); }
      if (endpoint === '/wishlist') return send(products.filter(p => wishlist.has(p.id)).map(p => ({ ...p, variant_id: p.id, group_id: p.id, price: p.variants[0].price })));
      if (endpoint === '/orders/cart') {
        if (method === 'POST') {
          const product = products.find(p => p.id === Number(body.variant_id));
          if (!product) return send({ error: 'Demo variant not found' }, 404);
          const existing = cart.find(item => item.variant_id === product.id);
          if (existing) existing.quantity += Number(body.quantity) || 1;
          else cart.push({ id: product.id, variant_id: product.id, group_id: product.id, name: product.name, group_name: product.name, variant_name: 'Standard', price: product.variants[0].price, quantity: Number(body.quantity) || 1, stock: 24 });
          return send({ success: true });
        }
        return send(cart);
      }
      if (/^\/orders\/cart\/\d+$/.test(endpoint)) {
        const id = Number(endpoint.split('/').pop());
        if (method === 'DELETE') cart = cart.filter(item => item.id !== id);
        else if (method === 'PUT') cart = cart.map(item => item.id === id ? { ...item, quantity: Number(body.quantity) || 1 } : item);
        return send({ success: true });
      }
      if (endpoint === '/orders') return send({ orders: [], total: 0 });
      if (endpoint === '/chat/messages') return send([]);
      if (endpoint === '/marketing/hit') return send({ success: true });
      // Explicit failure makes missing fixtures visible instead of inventing a
      // successful payment, upload, fulfilment action, or settings mutation.
      return send({ error: `UI demo has no fixture for ${method} ${endpoint}. Add one in ui/demo-api.mjs.` }, 501);
    } catch (err) {
      return send({ error: `Invalid demo request: ${err.message}` }, 400);
    }
  };
}
