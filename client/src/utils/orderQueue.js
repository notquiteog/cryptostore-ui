const key = userId => `cs.order-navigation.v1:${userId}`;
export function readOrderQueue(userId) {
  try { const q = JSON.parse(sessionStorage.getItem(key(userId))); return q && Date.now() - q.at < 3600000 && Array.isArray(q.ids) ? q : null; } catch { return null; }
}
export function writeOrderQueue(userId, value) {
  try { sessionStorage.setItem(key(userId), JSON.stringify({ ...value, at: Date.now() })); } catch { /* Navigation still works when storage is blocked. */ }
}
