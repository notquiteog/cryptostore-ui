// A proxy outage can return cached catalog data while navigator.onLine is
// still true. Track those responses independently of the device radio state.
const stalePaths = new Set();
const listeners = new Set();
export const hasOfflineCatalog = () => stalePaths.size > 0;
export function subscribeOfflineCatalog(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function recordCatalogResponse(path, response) {
  const before = hasOfflineCatalog();
  if (response.headers.get('X-CS-Offline') === '1') stalePaths.add(path);
  else if (response.ok) stalePaths.delete(path);
  if (before !== hasOfflineCatalog()) for (const listener of listeners) listener();
}
