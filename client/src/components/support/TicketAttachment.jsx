import { useState, useEffect } from 'react';
import { Image as ImageIcon } from 'lucide-react';

/**
 * One attachment, fetched with the caller's credentials.
 *
 * Shared by the ticket page and the dispute desk. A dispute's thread IS a
 * support ticket (migration 20261009000000), its files come out of the same
 * table through the same authenticated route, and the first version of the
 * dispute desk simply did not draw them — the merge's whole motivation, the
 * photograph of a damaged parcel, was visible on one desk and not the other.
 * One component, so the next fix to how a file is fetched lands on both.
 *
 * Attachments used to be public files under `/uploads/support/...` and the row
 * carried a `path` the browser could load on its own. They now live behind
 * `GET /api/support/attachments/:id`, which re-runs the ticket's ownership rule
 * on every retrieval — and the API only sends `url`, so rendering `att.path`
 * produced `<img src={undefined}>` for customers and staff alike.
 *
 * A bare `src={att.url}` does not work either: the browser will not attach the
 * JWT. `utils/api.js` carries it as an `Authorization: Bearer` header out of
 * localStorage, and the server's `extractToken` only falls back to a cookie a
 * reverse proxy sets, which this deployment does not. So the bytes have to come
 * through `fetch` with that same header and be handed to the tag as a blob URL.
 *
 * Blob URLs are pinned in memory until they are revoked, so a ticket thread
 * with a dozen screenshots would leak all of them on every navigation. The
 * cleanup below revokes on unmount, and also covers the race where the fetch
 * lands after the component is gone.
 */
export default function TicketAttachment({ att }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;

    (async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(att.url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setBlobUrl(objectUrl);
      } catch {
        // A failed attachment must not take the thread down with it — the
        // message body is the part that matters. Say so in place instead.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [att.url]);

  const mime = att.mime_type || '';

  if (failed) {
    return (
      <div className="glass-btn glass-btn-sm" style={{ color: 'var(--danger)', cursor: 'default' }}>
        <ImageIcon size={14} aria-hidden="true" /> {att.filename || 'Attachment'} (unavailable)
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="glass-btn glass-btn-sm" style={{ color: 'var(--text-secondary)', cursor: 'default' }}>
        <span className="spinner spinner-inline" /> Loading…
      </div>
    );
  }

  if (mime.startsWith('video/')) {
    // Not wrapped in a link: a click on a <video> belongs to its own controls.
    return (
      <video src={blobUrl} controls style={{ maxWidth: 200, borderRadius: 'var(--radius-sm)' }} />
    );
  }

  return (
    <a href={blobUrl} target="_blank" rel="noopener noreferrer"
      download={att.filename || undefined} style={{ display: 'block', maxWidth: 200 }}>
      {mime.startsWith('image/') ? (
        <img src={blobUrl} alt={att.filename} style={{
          maxWidth: '100%', borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
        }} />
      ) : (
        <div className="glass-btn glass-btn-sm">
          <ImageIcon size={14} aria-hidden="true" /> {att.filename}
        </div>
      )}
    </a>
  );
}
