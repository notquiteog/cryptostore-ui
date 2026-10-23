import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { setPageHead, clearPageHead, setRouteHead } from '../utils/documentHead';

/**
 * Give the document's head what this page knows.
 *
 *   useDocumentHead({ title: product?.name, description: product?.description });
 *
 * Every field is optional and may be undefined while the data is still
 * loading — the route's defaults (config/pageHead.js) show until it lands.
 * Re-applied whenever a value changes, and withdrawn when the page unmounts,
 * keyed by pathname so a response that arrives after the visitor has moved
 * on cannot title the page they moved to. See utils/documentHead.js for how
 * the layers compose.
 *
 *   title          the page's own name; the store's name is appended
 *   description    what a search result should quote for this page
 *   robots         a directive to force — `'noindex, follow'` on a search
 *                  result, `'noindex, nofollow'` on the not-found page
 *   canonicalPath  the one path this page answers to, when it is not the
 *                  current pathname (the catalogue keeps its category and
 *                  page number, drops everything else); null for none
 */
export default function useDocumentHead(head) {
  const { pathname } = useLocation();
  // Compared by value: pages build the object inline on every render.
  const key = JSON.stringify(head || null);
  useEffect(() => {
    setPageHead(pathname, head || {});
    return () => clearPageHead(pathname);
  }, [pathname, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The Layout's half: the route defaults, on every navigation. */
export function useRouteHead() {
  const { pathname } = useLocation();
  useEffect(() => { setRouteHead(pathname); }, [pathname]);
}
