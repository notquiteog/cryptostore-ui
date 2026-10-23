import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ChevronLeft, ChevronRight, Clock, Film, ImageIcon, Star, Trash2, Upload,
} from 'lucide-react';
import ProgressBar from '../ProgressBar';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { hasAdminPermission } from '../../utils/adminPermissions';
import { MEDIA_JOBS_PERMISSION, shouldPollMediaJobs, nextPollDelay, sameMediaList, POLL_ACTIVE_MS } from '../../utils/mediaJobsPolling';

/**
 * The media slots on a product or a variant.
 *
 * One component for both, because they are the same object: an ordered list of
 * slots, each of which holds either an image or a video, interchangeably. That
 * interchangeability is the point — the import format has always carried a list
 * of filenames per item with no type field, so a slot is defined by its
 * position, not by what happens to be in it.
 *
 * What this replaces did none of that. Group media rendered every row as an
 * `<img>`, so a video slot was a broken-image icon; variant media had no UI at
 * all — files went up and could never be seen or removed again; and there was
 * no way to choose which slot was first, which is the one thing an operator
 * actually wants from a media manager, because slot one is the thumbnail on
 * every card in the store.
 *
 * Everything uploaded here is re-encoded server-side before it is stored — see
 * services/mediaService.js — so what the store publishes is never the file the
 * operator picked. That matters as much for staff photos as for customers':
 * a phone photo of the actual stock carries the GPS fix of wherever it was
 * taken.
 */

// quicktime/HEIC listed so iOS stops trying (and failing) to transcode iPhone
// captures before handing them over: with these named, the picker offers the
// raw `.mov`/`.heic`, both of which the server re-encodes. Without them an
// iPhone upload could fill the bar to 100% and then die on the server's
// whitelist with no message the operator ever saw.
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,image/heic,image/heif,image/avif,image/tiff,video/x-matroska,video/x-msvideo';

function humanSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function humanDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const total = Math.round(n / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function Slot({ item, index, total, busy, onDelete, onMove }) {
  const isVideo = item.media_type === 'video';
  const poster = item.poster_path || (isVideo ? null : item.path);
  const size = humanSize(item.size_bytes);
  const duration = humanDuration(item.duration_ms);

  return (
    <figure className={`mslot${isVideo ? ' is-video' : ''}${index === 0 ? ' is-hero' : ''}`}>
      <div className="mslot-frame">
        {isVideo ? (
          // Muted + preload=metadata: a grid of autoplaying product demos is
          // both a bandwidth problem and unreadable. The poster is what the
          // operator is judging; the controls are there if they want to check
          // the encode actually worked.
          <video
            src={item.path}
            poster={poster || undefined}
            controls
            muted
            playsInline
            preload="metadata"
          />
        ) : poster ? (
          <img src={poster} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="mslot-blank"><ImageIcon size={20} aria-hidden="true" /></span>
        )}

        {index === 0 && (
          <span className="mslot-hero" title="Used as the thumbnail everywhere in the store">
            <Star size={10} aria-hidden="true" /> Cover
          </span>
        )}

        <span className="mslot-kind">
          {isVideo ? <Film size={10} aria-hidden="true" /> : <ImageIcon size={10} aria-hidden="true" />}
          {isVideo ? 'Video' : 'Image'}
        </span>
      </div>

      <figcaption className="mslot-meta">
        <span className="mslot-dims">
          {item.width && item.height ? `${item.width}×${item.height}` : '—'}
          {duration && <> · <Clock size={9} aria-hidden="true" /> {duration}</>}
          {size && <> · {size}</>}
        </span>
      </figcaption>

      <div className="mslot-actions">
        <button
          type="button"
          className="mslot-btn"
          onClick={() => onMove(index, -1)}
          disabled={busy || index === 0}
          aria-label="Move earlier"
          title="Move earlier"
        >
          <ChevronLeft size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="mslot-btn"
          onClick={() => onMove(index, 1)}
          disabled={busy || index === total - 1}
          aria-label="Move later"
          title="Move later"
        >
          <ChevronRight size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="mslot-btn is-danger"
          onClick={() => onDelete(item)}
          disabled={busy}
          aria-label="Remove this slot"
          title="Remove"
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </div>
    </figure>
  );
}

export default function MediaSlots({
  scope,            // 'group' | 'variant'
  ownerId,          // group id or variant id
  items,
  onChange,
  disabled,
  hint,
  // ── A parent-fed slot ────────────────────────────────────────────────────
  // `feed` is this owner's entry from a page-level poll (hooks/
  // useMediaJobsFeed): `{ jobs, media, startedAt }`, or `null` while the page
  // has not heard yet. When the prop is present at all — even as null — the
  // slot does NOT poll for itself: the product editor draws one of these per
  // variant, and one poll per slot is the fan-out that tripped the global
  // rate limiter on a 268-variant product. Left out entirely, the slot polls
  // on its own, so a caller with a single slot keeps working unchanged.
  feed,
  feedError,
  onFeedRefresh,
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [jobError, setJobError] = useState('');
  const [cancelling, setCancelling] = useState(null);
  const onChangeRef = useRef(onChange);

  // Whether this person may touch media at all. `products.media` gates the
  // upload, the delete AND the progress route, so a viewer without it has
  // nothing to poll for — and polling anyway is what filled a 268-variant
  // editor with twenty thousand 403s and tripped the device's global rate
  // limiter (see utils/mediaJobsPolling.js). Read from the signed-in user the
  // same way ProductEdit reads its own grants; the server enforces it
  // independently, this only stops the UI asking a question it cannot have
  // answered.
  const { user } = useAuth();
  const canManage = hasAdminPermission(user, MEDIA_JOBS_PERMISSION);
  // "Locked" is the one word the handlers below test: the caller's `disabled`
  // (a draft that has no id yet) and the missing grant read the same way.
  const locked = disabled || !canManage;
  onChangeRef.current = onChange;
  const revision = useRef(0);
  // When this slot last changed its own media, so an answer that was READ
  // before that moment — the page feed's `startedAt`, or a self-poll that
  // started earlier — cannot overwrite a newer local list. The revision
  // counter is the same guard for the self-poll; the timestamp is the form
  // a shared request can be compared against.
  const mutatedAt = useRef(0);
  const [refresh, setRefresh] = useState(0);
  const fed = feed !== undefined;
  // "Ask again now": the page feed when there is one, the own poll otherwise.
  const nudge = () => { if (fed) onFeedRefresh?.(); else setRefresh((value) => value + 1); };
  const busyRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const uploadPath = scope === 'group'
    ? `/products/${ownerId}/media`
    : `/products/variants/${ownerId}/media`;

  const jobsPath = `/products/media/${scope}/${ownerId}/jobs`;
  useEffect(() => {
    // Gate and cadence both come from utils/mediaJobsPolling, where they are
    // tested. This effect used to reschedule itself unconditionally at a
    // literal 2.5 s in its `finally`, which turned every 403 into the next
    // 403 — the request storm the helper's header describes. A slot the page
    // feeds never polls at all; see the `feed` prop.
    if (fed) return;
    if (!shouldPollMediaJobs({ ownerId, disabled, canManage })) return;
    let active = true, timer;
    let lastDelay = POLL_ACTIVE_MS;
    const controller = new AbortController();
    const poll = async () => {
      const version = revision.current;
      let next;
      try {
        const result = await api.get(jobsPath, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        if (!active) return;
        setJobs(result.jobs || []);
        setJobError('');
        if (!busyRef.current && version === revision.current && Array.isArray(result.media)
          && !sameMediaList(result.media, itemsRef.current)) onChangeRef.current(result.media);
        next = nextPollDelay({
          ok: true,
          hasActiveJobs: (result.jobs || []).some(job => ['queued', 'running'].includes(job.state)),
        });
      } catch (err) {
        if (!active) return;
        next = nextPollDelay({ ok: false, status: err?.status ?? null, previousDelay: lastDelay });
        // A refusal is final for this page load: the grant will not appear by
        // asking again, and the message says so rather than promising a
        // reconnection that is never coming.
        setJobError(next == null
          ? 'Encoding progress is not available to your account.'
          : 'Progress is temporarily unavailable. Your uploads stay queued; reconnecting…');
      }
      if (!active || next == null) return;
      lastDelay = next;
      timer = setTimeout(poll, next);
    };
    poll();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [jobsPath, ownerId, disabled, canManage, refresh, fed]);

  // What the page's own poll heard about this owner. Jobs are shown as they
  // are; the media list is applied only when it was read after this slot's
  // last change and actually differs, for the reasons on `mutatedAt` and
  // `sameMediaList`.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    if (!fed) return;
    setJobError(feedError || '');
    if (!feed) return;
    setJobs(feed.jobs || []);
    if (busyRef.current) return;
    if (!Array.isArray(feed.media)) return;
    if ((feed.startedAt || 0) <= mutatedAt.current) return;
    if (sameMediaList(feed.media, itemsRef.current)) return;
    onChangeRef.current(feed.media);
  }, [fed, feed, feedError]);

  const cancelJob = async (job) => {
    setCancelling(job.id);
    try {
      const result = await api.delete(`${jobsPath}/${job.id}`);
      if (result.cancelled) setJobs(list => list.map(item => item.id === job.id ? { ...item, state: 'cancelled', stage: 'cancelled' } : item));
      else toast('This file has already finished processing.');
      nudge();
    } catch (err) { toast.error(err.message || 'Could not cancel encoding'); }
    finally { setCancelling(null); }
  };

  const upload = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0 || busyRef.current || locked) return;
    if (files.length > 10) { toast.error('Choose up to 10 files at a time.'); return; }
    revision.current += 1;
    mutatedAt.current = Date.now();
    busyRef.current = true;
    setProgress({ stage: 'uploading', percent: 0 });

    setBusy(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      const result = await api.upload(uploadPath, fd, { onProgress: setProgress });

      if (Array.isArray(result.jobs)) {
        setJobs(list => [...result.jobs, ...list.filter(job => !result.jobs.some(next => next.id === job.id))]);
        toast.success('Uploaded. Encoding continues in the background.');
      } else {
        // Rolling deployment compatibility with the synchronous upload API.
        const media = Array.isArray(result) ? result : result.media;
        onChange(media || []);
        const failed = Array.isArray(result) ? [] : result.failed || [];
        if (failed.length) toast.error(`${failed.length} file${failed.length === 1 ? '' : 's'} could not be processed: ${failed.map(file => file.name).join(', ')}`);
        else toast.success(`${files.length} file${files.length === 1 ? '' : 's'} added`);
      }
    } catch (err) {
      toast.error(err.message || 'Upload failed');
    } finally {
      busyRef.current = false;
      setProgress(null);
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
      nudge();
    }
    // `nudge` reads `fed` and `onFeedRefresh` from the closure; both are
    // props that do not change for a mounted slot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadPath, onChange, locked]);

  const remove = async (item) => {
    if (!confirm('Remove this slot? The file is deleted from the server.')) return;
    revision.current += 1;
    mutatedAt.current = Date.now();
    busyRef.current = true;
    setProgress({ stage: 'removing' });
    setBusy(true);
    try {
      await api.delete(`/products/media/${scope}/${item.id}`);
      onChange(items.filter((i) => i.id !== item.id));
      toast.success('Removed');
    } catch (err) {
      toast.error(err.message || 'Could not remove it');
    } finally {
      busyRef.current = false;
      setProgress(null);
      setBusy(false);
    }
  };

  const move = async (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;

    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    // Optimistic: the reorder is instant and visual, and the request that
    // follows only persists it. A failure re-reads from the server response.
    onChange(next);

    revision.current += 1;
    mutatedAt.current = Date.now();
    busyRef.current = true;
    setProgress({ stage: 'ordering' });
    setBusy(true);
    try {
      const saved = await api.put(`/products/media/${scope}/${ownerId}/order`, {
        order: next.map((i) => i.id),
      });
      onChange(saved);
    } catch (err) {
      toast.error(err.message || 'Could not save the new order');
      onChange(items);
    } finally {
      busyRef.current = false;
      setProgress(null);
      setBusy(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (locked || busy) return;
    upload(e.dataTransfer?.files);
  };

  return (
    <div className="mslots">
      {items.length > 0 && (
        <div className="mslots-grid">
          {items.map((item, i) => (
            <Slot
              key={item.id}
              item={item}
              index={i}
              total={items.length}
              busy={busy || locked}
              onDelete={remove}
              onMove={move}
            />
          ))}
        </div>
      )}

      {jobs.length > 0 && (
        <section className="media-jobs" aria-label="Media processing">
          <div className="media-jobs-heading">
            <strong>Media processing</strong>
            <span>You can leave this page. Progress is saved.</span>
          </div>
          {jobs.map(job => {
            const active = ['queued', 'running'].includes(job.state);
            const label = { queued: 'Waiting to encode…', encoding: 'Encoding media…', verifying: 'Checking video…', poster: 'Creating video preview…', saving: 'Saving media…' }[job.stage] || 'Processing media…';
            return <div key={job.id} className={`media-job is-${job.state}`}>
              <div className="media-job-content">
                <span className="media-job-name">{job.original_name}{job.replace_media_id ? ' · Compressing saved media' : ''}</span>
                {active ? <ProgressBar label={label} value={job.percent} /> : (
                  <span className="media-job-result">{job.state === 'completed' ? 'Ready' : job.state === 'cancelled' ? 'Cancelled' : job.error || 'Could not process this file'}</span>
                )}
              </div>
              {active && <button type="button" className="glass-btn glass-btn-sm" disabled={cancelling === job.id}
                onClick={() => cancelJob(job)} aria-label={`Cancel encoding ${job.original_name}`}>
                {cancelling === job.id ? 'Cancelling…' : 'Cancel'}
              </button>}
            </div>;
          })}
        </section>
      )}
      {jobError && <p className="media-jobs-error" role="status">{jobError}</p>}

      <div
        className={`mslots-drop${dragging ? ' is-dragging' : ''}${locked ? ' is-disabled' : ''}${busy ? ' is-busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!locked && !busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          id={`mslots-${scope}-${ownerId}`}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          disabled={locked || busy}
          onChange={(e) => upload(e.target.files)}
        />
        {busy ? (
          <ProgressBar
            label={{ uploading: 'Uploading files…', preparing: 'Preparing media…', queued: 'Waiting for the media processor…', encoding: 'Encoding media…', verifying: 'Checking video…', poster: 'Creating video preview…', saving: 'Saving media…', removing: 'Removing media…', ordering: 'Saving media order…' }[progress?.stage] || 'Processing media…'}
            value={progress?.percent}
            detail={progress?.file
              ? `File ${progress.index} of ${progress.total} · ${progress.file}`
              : progress?.stage === 'uploading' || progress?.stage === 'preparing'
                ? 'Keep this page open until the upload finishes. Encoding can continue after you leave.' : undefined}
          />
        ) : !canManage ? (
          /* Read-only, and said so. A disabled upload label that still reads
             "Drop images here" invites a drag that does nothing; naming the
             grant tells the person which door is shut and whom to ask. */
          <p className="mslots-drop-label mslots-readonly" role="note">
            <span className="mslots-drop-title">Media is read-only for your account</span>
            <span className="mslots-drop-sub">
              Uploading, removing and reordering need the “Manage media” permission.
            </span>
          </p>
        ) : (
          <label htmlFor={`mslots-${scope}-${ownerId}`} className="mslots-drop-label">
            <Upload size={18} aria-hidden="true" />
            <span className="mslots-drop-title">Drop images or video here</span>
            <span className="mslots-drop-sub">
              {hint || 'JPEG, PNG, WebP, GIF, MP4 or WebM. Slots hold either kind — the first is the cover.'}
            </span>
          </label>
        )}
      </div>
    </div>
  );
}
