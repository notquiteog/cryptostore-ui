import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import MicroMarkdown from '../utils/microMarkdown';
import { FileQuestion } from 'lucide-react';
import useDocumentHead from '../hooks/useDocumentHead';
import { clipDescription, plainMarkdown, ROBOTS_PRIVATE } from '../utils/documentHead';

/**
 * One operator-authored page (privacy policy, about us).
 *
 * Public on purpose — these pages are the store speaking to visitors who may
 * not have an account yet, which is exactly when a privacy policy matters.
 * The slug is a prop, not a route param: the router mounts /privacy and
 * /about explicitly, so a typo'd URL is a router 404 rather than a fetch.
 */
export default function StorePage({ slug }) {
  const [page, setPage] = useState(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    setPage(null);
    api.get(`/settings/pages/${slug}`)
      .then((data) => { if (!cancelled) setPage(data); })
      .catch(() => { if (!cancelled) setMissing(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  // The page's own title on the tab, its first lines as the snippet, and —
  // for a page that is switched off — the not-found head, which is what the
  // server put on it too. This used to write document.title directly, which
  // the theme's own write then overwrote on the next mode toggle.
  useDocumentHead({
    title: missing ? 'Page not found' : page?.title,
    description: page ? clipDescription(plainMarkdown(page.body_md)) || undefined : undefined,
    robots: missing ? ROBOTS_PRIVATE : undefined,
  });

  if (loading) {
    return (
      <div className="page container store-page">
        <div className="skeleton" style={{ height: 36, width: '40%', marginBottom: 'var(--sp-6)' }} />
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  if (missing || !page) {
    return (
      <div className="page container store-page">
        <div className="glass-card empty-state">
          <FileQuestion size={34} aria-hidden="true" />
          <h3>This page isn&apos;t available</h3>
          <p>It may have been switched off. The rest of the store is still here.</p>
          <Link to="/" className="glass-btn glass-btn-primary">Back to the store</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page container store-page">
      <h1 className="store-page-title">{page.title}</h1>
      <div className="glass-card store-page-card">
        <MicroMarkdown className="store-page-body" source={page.body_md} />
      </div>
    </div>
  );
}
