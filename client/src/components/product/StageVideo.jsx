import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';

/* A clip this short is a turntable spin or a texture pan, and stopping one on a
   frozen last frame reads as a player that broke rather than a loop that
   finished. Anything longer is something a buyer watches once: looping a
   two-minute walkthrough beside a variant list is exactly the "loop that stops
   being decoration and starts being a distraction" the stage bloom talks
   itself out of, one file over in 12-product-detail.css. */
const LOOP_MAX_SECONDS = 12;

/* Arrow-key seek, in seconds. */
const SEEK_STEP = 5;

function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/**
 * True when the visitor has asked their browser to spend less data.
 *
 * Chromium-only. Absent everywhere else, which is read as "no preference"
 * rather than as "yes": assuming yes would disable autoplay outright on
 * Firefox and Safari. It is worth knowing that this is *not* the whole answer
 * for the deployment this project cares most about — Tor Browser does not set
 * it — which is why the clip a buyer never selects is never fetched either.
 */
function prefersLessData() {
  return typeof navigator !== 'undefined' && navigator.connection?.saveData === true;
}

/**
 * The product stage's video: plays on its own, with our furniture instead of
 * the browser's.
 *
 * Two things had to be true at once. Autoplay without a click is only ever
 * granted to a *muted* video — every engine refuses it otherwise — and the
 * native `controls` bar is a black slab that lands over the artwork and turns
 * the one piece of the stage we do not style into the loudest thing on it. So
 * the element is muted and chrome-less, and the pause/mute/seek the buyer is
 * owed lives on the same glass plate as the expand button and the arrows.
 *
 * Losing `controls` means every job it did has to be done here, and the two
 * that are easy to forget are the ones that matter:
 *
 *   - **A pause must exist.** WCAG 2.2.2 requires one for anything that
 *     auto-plays past five seconds, and a video with no visible control is a
 *     hostage situation on a touch screen, where there is no hover to reveal
 *     one. The controls therefore start visible and only hide themselves on a
 *     hover-capable pointer — and even there they stay up whenever the clip is
 *     not playing, so a paused or refused video always shows the way out.
 *   - **A refusal must be visible.** `play()` returns a promise that rejects
 *     with NotAllowedError when the browser declines. Unhandled, that leaves a
 *     frozen first frame with no controls at all: the silent half-working
 *     failure. The rejection is caught and the play button is what the buyer
 *     gets instead.
 *
 * "While the buyer is viewing it" is two gates, not one. Being the selected
 * item is the caller's half — it renders only `current` — and being on screen
 * is this component's, because the media column is `position: sticky` and will
 * happily keep a clip playing to nobody a long way down the page. A hidden tab
 * counts as not viewing, too: opening a product in a background tab is half of
 * how shopping works.
 *
 * `suspended` is the caller's hand on the same switch, and it exists because
 * "on screen" is not the same question as "the thing the buyer is looking at".
 * The lightbox renders over the stage without unmounting it, and the gallery
 * shares one index with it — so arrowing onto a clip inside the lightbox left
 * the stage playing the very same file behind the overlay: two downloads, two
 * decoders, and two playheads that drift apart while one of them is invisible.
 *
 * Autoplay is also the page's most bandwidth-expensive habit, so it is opt-out
 * twice over: `prefers-reduced-motion` (autoplaying video is decorative motion
 * under the house rule, and the poster is the still it degrades to) and the
 * browser's own data-saver hint. Neither disables the video — they disable it
 * *starting by itself*.
 */
export default function StageVideo({ src, poster, className, label, suspended = false }) {
  const reduced = usePrefersReducedMotion();
  const videoRef = useRef(null);

  const [onScreen, setOnScreen] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    () => (typeof document === 'undefined' ? true : !document.hidden)
  );
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(true);
  const [blocked, setBlocked] = useState(false);
  // Pressed pause deliberately. Distinct from "we paused it because it left
  // the viewport": scrolling back to a clip the buyer stopped must not restart
  // it, which a single `playing` flag cannot express.
  const [userPaused, setUserPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);

  /* React applies `muted` as a DOM *property*, not an attribute, and the
     property is what the autoplay policy reads. Setting it the instant the
     element exists — before any effect can call play() — is the difference
     between muted autoplay and a NotAllowedError, and the symptom of getting
     it wrong is the exact frozen frame this component exists to avoid. */
  const attach = useCallback((el) => {
    videoRef.current = el;
    if (el) el.muted = true;
  }, []);

  /* Declared before the playback effect so that on mount the element is
     already muted by the time anything asks it to play. */
  useEffect(() => {
    const el = videoRef.current;
    if (el) el.muted = muted;
  }, [muted]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    // No IntersectionObserver: treat the clip as visible rather than never
    // playing it. The controls are the fallback either way.
    if (typeof IntersectionObserver === 'undefined') {
      setOnScreen(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const sync = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  /* The element is the authority on what it is doing, not this component: a
     browser can pause a video on its own (a phone call, a Picture-in-Picture
     handoff, running out of buffer), and state we set optimistically beside
     `play()` would then describe a video that is not playing. Everything below
     is read back off the element's own events. */
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;

    const onPlay = () => { setPlaying(true); setEnded(false); setBlocked(false); };
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setEnded(true); };
    const onTime = () => setTime(el.currentTime);
    const onVolume = () => setMuted(el.muted);
    const onMeta = () => {
      const seconds = Number.isFinite(el.duration) ? el.duration : 0;
      setDuration(seconds);
      // A property rather than a prop: the decision needs a duration, which
      // only exists after metadata arrives, and re-rendering to set it would
      // mean a render that depends on the element it is rendering.
      el.loop = seconds > 0 && seconds <= LOOP_MAX_SECONDS;
    };

    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('volumechange', onVolume);
    el.addEventListener('loadedmetadata', onMeta);
    // Metadata can already be in hand when this runs, in which case the event
    // has been and gone and the track would never learn its length.
    if (el.readyState >= 1) onMeta();

    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('volumechange', onVolume);
      el.removeEventListener('loadedmetadata', onMeta);
    };
  }, [src]);

  /* The one place that decides whether the clip should be running. */
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const wanted = onScreen && pageVisible && !suspended && !userPaused && !reduced && !prefersLessData();
    if (!wanted) {
      if (!el.paused) el.pause();
      return;
    }
    // A finished clip holds its last frame until asked again. Replay is a
    // button, not something that happens because the page scrolled.
    if (ended && !el.loop) return;

    const started = el.play();
    if (started?.catch) started.catch(() => setBlocked(true));
  }, [onScreen, pageVisible, suspended, userPaused, reduced, ended]);

  const toggle = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused || el.ended) {
      if (el.ended) el.currentTime = 0;
      setUserPaused(false);
      // A press is a user gesture, which is the one thing the autoplay policy
      // never refuses — so a clip that was blocked stops being blocked here.
      setBlocked(false);
      const started = el.play();
      if (started?.catch) started.catch(() => setBlocked(true));
    } else {
      setUserPaused(true);
      el.pause();
    }
  }, []);

  const toggleMute = useCallback(() => setMuted(m => !m), []);

  const seekTo = useCallback((seconds) => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const next = Math.max(0, Math.min(el.duration, seconds));
    el.currentTime = next;
    setTime(next);
  }, []);

  const onTrackClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    seekTo(((e.clientX - rect.left) / rect.width) * (videoRef.current?.duration || 0));
  };

  const onTrackKey = (e) => {
    const el = videoRef.current;
    if (!el) return;
    const jump = { ArrowRight: SEEK_STEP, ArrowLeft: -SEEK_STEP };
    if (e.key in jump) {
      // The stage listens for the same two keys to change which media is
      // shown. Without this the buyer nudging a clip forward five seconds also
      // leaves the clip.
      e.preventDefault();
      e.stopPropagation();
      seekTo(el.currentTime + jump[e.key]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      seekTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      seekTo(el.duration || 0);
    }
  };

  const fraction = duration > 0 ? Math.min(1, time / duration) : 0;
  const action = ended ? 'Replay' : playing ? 'Pause' : 'Play';

  return (
    <>
      <video
        ref={attach}
        src={src}
        poster={poster || undefined}
        className={className}
        playsInline
        muted
        /* Autoplay is what pulls the bytes, and it only fires for a clip the
           buyer has actually selected and is actually looking at. With a
           poster there is nothing to fetch to paint the stage at all, so a
           product page whose first item is a photo costs a buyer on a metered
           or filtered connection nothing for the videos behind it.

           Deliberately not `controls`: the whole point of the component. */
        preload={poster ? 'none' : 'metadata'}
        aria-label={label || undefined}
      />

      {/* `data-idle` keeps the controls up whenever the clip is not running,
          which covers the two states a buyer cannot otherwise get out of: a
          refused autoplay and a deliberate pause. */}
      <div className="pd-video-controls" data-idle={playing ? undefined : ''}>
        <div className="pd-video-pill">
          <button
            type="button"
            className="pd-video-btn"
            onClick={toggle}
            aria-label={`${action} video`}
            title={`${action} video`}
          >
            {ended
              ? <RotateCcw size={14} aria-hidden="true" />
              : playing
                ? <Pause size={14} aria-hidden="true" />
                : <Play size={14} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="pd-video-btn"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute video' : 'Mute video'}
            title={muted ? 'Unmute video' : 'Mute video'}
          >
            {muted
              ? <VolumeX size={14} aria-hidden="true" />
              : <Volume2 size={14} aria-hidden="true" />}
          </button>
        </div>

        <div
          className="pd-video-track"
          role="slider"
          tabIndex={0}
          aria-label="Seek video"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(time)} of ${clock(duration)}`}
          onClick={onTrackClick}
          onKeyDown={onTrackKey}
        >
          <span className="pd-video-fill" style={{ transform: `scaleX(${fraction})` }} />
        </div>
      </div>

      {blocked && (
        <span className="sr-only" role="status">
          This video did not start on its own. Use the play button to watch it.
        </span>
      )}
    </>
  );
}
