import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import pageContext from '../../utils/pageContext';
import ResultCard from './ResultCard';
import suggestedQuestions from '../../utils/suggestedQuestions';
import { ASK_EVENT } from '../../utils/askAssistant';
import { Mic, Square, X, RotateCcw, ShieldCheck, Brain, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import BuddySprite from './BuddySprite';
import useCompanionAttention, { useCompanionMotion } from './useCompanionAttention';
import useCompanionRoam, { SPEED } from './useCompanionRoam';
import useKeyboardInset from '../../hooks/useKeyboardInset';
import { framesFor, animalFor } from './sprites';
import { resolveCompanion, motionAllowed, storedCompanion, subscribeCompanion } from '../../utils/companion';
import { companionPng } from '../../utils/companionIcon';
import { api, powFetch } from '../../utils/api';
import { getAiStatus, invalidateAiStatus } from '../../utils/aiStatus';
import { readNdjson } from '../../utils/aiStream';
import { useAuth } from '../../context/AuthContext';
import { CART_CHANGED } from '../../context/CartContext';
import { conversationSnapshot, subscribeConversation, claimConversation, clearConversation,
  setConversationTurns, setConversationBusy, conversationExpired,
  acknowledgeExpiry } from '../../utils/aiConversation';

/**
 * The assistant's affordance: a pixel animal in the navbar.
 *
 * ── The buddy is a status light that happens to be a button ─────────────────
 *
 * `docs/DESIGN.md` §10: a flourish must do a job. This one's job is that the
 * AI system's state is otherwise invisible to everybody. Every state below is
 * read from something real, so the animal cannot flatter and cannot lie:
 *
 *   absent    the capability is off for this shop, or for this person
 *   sleep     the model is unreachable
 *   idle      ready
 *   think     generating right now
 *   talk      reading an answer aloud
 *
 * A buddy that looked cheerful while the model was down would be worse than no
 * buddy at all. One that visibly dozes off when a tunnel drops is the clearest
 * status indicator in the product.
 *
 * ── The three states that mean nothing ──────────────────────────────────────
 *
 * `perk` on hover, `greet` when the panel opens, `happy` when somebody clicks
 * the animal twice. These are the only states here that are not read from
 * something real, and they are safe precisely because they cannot be mistaken
 * for one that is: each is a one-shot or hover-scoped burst that hands control
 * straight back to whatever the status actually was. A greeting cannot hide a
 * sleeping model, because a second later the animal is asleep again.
 *
 * They are declined outright under `prefers-reduced-motion` rather than
 * started and paused. A companion frozen mid-greeting reads as broken, and the
 * CSS pause that protects the idle loop would do exactly that to a one-shot.
 *
 * ── Which animal ────────────────────────────────────────────────────────────
 *
 * The operator picks the store's companion and decides whether anybody may
 * change it; a person who may, picks in their own browser. `resolveCompanion`
 * in utils/companion.js is the only place those are combined — see its
 * comment for why the personal choice is not a column on `users`.
 *
 * ── What it does not do ─────────────────────────────────────────────────────
 *
 * It renders nothing about the answer until asked. Nothing is stored in this
 * component on the server. The transcript stays in this browser tab until
 * the buyer clears it, logs out, or the operator’s inactivity timeout expires.
 *
 * ── Two surfaces, one component ──────────────────────────────────────────
 *
 * The storefront navbar, and the admin rail through AdminCompanion. The admin
 * has no navbar, so before this the operator's own assistant was somewhere
 * else entirely — leave the console, find it in the shop, ask, come back.
 *
 * `variant` moves the PANEL and nothing else: the conversation, the consent
 * gate, the voice turn and every status above are the buyer's, unchanged,
 * because an assistant that answered staff differently would be a second
 * assistant to keep in step with this one. What the rail actually needs is a
 * different anchor — see `docked` below.
 */

const speedFor = (animal) => SPEED * (animal ? animalFor(animal).speed : 1);

/** The shape of `/api/ai/status`, before it has answered. */
const UNKNOWN = { enabled: false, capabilities: [], buddy: { sprite: 'none' } };

export default function Buddy({ variant = 'nav', backgroundState = null }) {
  const [status, setStatus] = useState(UNKNOWN);
  /**
   * How hard to think, for the NEXT question only.
   *
   * Not persisted, and deliberately: this is a per-request control, so a level
   * chosen for one hard question should not silently make every later question
   * slow and expensive. `''` means "no opinion" and the shop uses the
   * operator's default for the capability — which is different from `off`,
   * which overrides it downwards.
   *
   * Whether it is rendered at all is `status.thinking_toggle`, resolved by the
   * server for THIS viewer (`ai_thinking_toggle`). The client never works out
   * the audience for itself, because a client that decides will eventually
   * decide differently from the route that enforces it.
   */
  const [think, setThink] = useState('');
  const [open, setOpen] = useState(false);
  /**
   * Bumped on every open, and fed to `suggestedQuestions` so a second visit
   * offers different prompts. A counter rather than `Math.random()` on
   * purpose: the sequence is then deterministic, testable, and cannot show the
   * same set twice running.
   */
  const [openCount, setOpenCount] = useState(0);
  useEffect(() => { if (open) setOpenCount((n) => n + 1); }, [open]);

  const openRef = useRef(false);
  openRef.current = open;
  const { user, loading: authLoading } = useAuth();
  const conversation = useSyncExternalStore(subscribeConversation, conversationSnapshot);
  const turns = conversation.turns;
  const setTurns = setConversationTurns;
  const [question, setQuestion] = useState('');
  const busy = conversation.busy;
  const setBusy = setConversationBusy;
  const [reachable, setReachable] = useState(true);
  const [voice, setVoice] = useState({ listen: false, speak: false });
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  // A decorative one-shot in flight, and whether the pointer is on the button.
  // Both are outranked by every real status below.
  const [burst, setBurst] = useState(null);
  // Which side the potter wanders off to. See the burst scheduler below.
  const [potterDir, setPotterDir] = useState(1);
  const [hovered, setHovered] = useState(false);
  useSyncExternalStore(subscribeCompanion, storedCompanion, () => null);
  const { attention, follow, resetAttention } = useCompanionAttention();
  const motion = useCompanionMotion();
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  // This browser is grinding a proof of work. See the `cs:pow` event in
  // utils/pow.js for why it arrives as an event and not as a callback.
  const [working, setWorking] = useState(false);
  // The navbar element the roaming layer is portalled into, found once the
  // button is in the document. See the roam layer's comment in
  // 100-ai-buddy.css for why it cannot simply live inside `.buddy-root`.
  const [nav, setNav] = useState(null);
  // Whether the panel is the phone's bottom sheet. This mirrors the
  // `max-width: 640px` block in 100-ai-buddy.css and has to keep mirroring
  // it: the CSS decides what the panel LOOKS like and this decides where it
  // is rendered, and a sheet rendered inside the navbar is the bug this
  // whole path exists to fix. Change one, change the other.
  const [phoneSheet, setPhoneSheet] = useState(false);
  const buttonRef = useRef(null);
  const layerRef = useRef(null);
  const location = useLocation();
  const rootRef = useRef(null);
  // The panel is a sibling of the button on desktop and a portal on a phone,
  // so "was the click inside?" has to ask both — see the click-outside effect.
  const panelRef = useRef(null);
  const recorderRef = useRef(null);
  const audioRef = useRef(null);
  const audioFetchRef = useRef(null);
  const audioContextRef = useRef(null);
  const logRef = useRef(null);
  const abortRef = useRef(null);
  const askRef = useRef(null);
  const captureRef = useRef(null);
  const idleMinutes = status.conversation_idle_minutes || 5;
  useEffect(() => {
    if (authLoading || status === UNKNOWN) return undefined;
    const owner = user?.id ?? 'guest';
    claimConversation(owner, idleMinutes);
    const expire = () => { if (conversationExpired(idleMinutes)) clearConversation(owner, 'idle'); };
    const timer = setInterval(expire, 1000);
    return () => clearInterval(timer);
  }, [user?.id, authLoading, idleMinutes, status]);
  useEffect(() => {
    abortRef.current?.abort();
    if (captureRef.current) {
      captureRef.current.cancelled = true; captureRef.current.controller?.abort();
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    }
    audioFetchRef.current?.abort();
    audioRef.current?.pause();
  }, [conversation.revision]);

  // The status, shared rather than fetched here. The navbar mounts this
  // component TWICE — the desktop action row and the mobile icon row are both
  // in the DOM, hidden from each other by a media query rather than by
  // unmounting — so a plain `api.get` here was two identical requests on every
  // page load, and the admin's copy tools want the same answer again. One
  // cached read serves all of them (utils/aiStatus).
  useEffect(() => {
    let alive = true;
    getAiStatus()
      .then((data) => { if (alive) setStatus(data || UNKNOWN); });
    // Which halves of voice this shop has. Asked separately because a shop can
    // have dictation and no speech, or the reverse, and the buttons must
    // reflect what actually exists rather than what is switched on.
    api.get('/ai/voice')
      .then((v) => { if (alive) setVoice({ listen: !!v.listen, speak: !!v.speak, converse: !!v.converse }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!open) return;
    getAiStatus().then((data) => setStatus(data || UNKNOWN));
    api.get('/ai/voice').then((v) => setVoice({ listen: !!v.listen, speak: !!v.speak, converse: !!v.converse })).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(max-width: 640px)');
    const sync = () => setPhoneSheet(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  /*
   * Where the keyboard is, while the sheet is open.
   *
   * Only the phone sheet asks. The desktop panel is absolutely positioned
   * against its own button inside the document, so nothing about it moves when
   * a keyboard appears — and the navbar mounts this component twice, so a hook
   * that subscribed regardless would put two listeners on every page for a
   * panel that is shut. See useKeyboardInset for what the numbers mean.
   */
  const keyboard = useKeyboardInset(open && phoneSheet);
  useEffect(() => {
    if (buttonRef.current && !buttonRef.current.getClientRects().length) setOpen(false);
  }, [phoneSheet]);

  // Close on click-outside and on Escape, like every other popover here.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      // Both boxes, because on a phone the panel is NOT inside the root: it is
      // portalled to `document.body`, so a tap on the ask field or the mic —
      // or anywhere in the sheet — is outside `rootRef` by every DOM measure
      // and used to shut the panel under the finger that reached for it.
      const inside = rootRef.current?.contains(e.target)
        || panelRef.current?.contains(e.target);
      if (!inside) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /*
   * ── Dragging the sheet shut ────────────────────────────────────────────────
   *
   * The phone sheet grew a grip, and a grip that does not grip is decoration
   * in a workspace (docs/DESIGN.md §7). The gesture lives here rather than in
   * the stylesheet because only the finger knows where it went.
   *
   * Pointer events, not touch events: §8's rule, and the same one `.livechat`
   * follows for its slide-to-open bubble. `touch-action: none` is on the HEAD
   * only (100-ai-buddy.css) — put it on the panel and the transcript stops
   * scrolling, which is the one gesture somebody uses more than this one.
   *
   * Downward only, and only past a slop: a thumb that moves four pixels while
   * pressing the close button is pressing the close button.
   */
  const dragRef = useRef(null);
  const [drag, setDrag] = useState(null);
  // A sheet that was dragged and then closed must not reopen mid-drag, and
  // `data-drag` suppresses the entrance animation — so it is cleared with the
  // panel rather than left lying about for the next open.
  useEffect(() => { if (!open) setDrag(null); }, [open]);

  const dragStart = useCallback((e) => {
    if (!phoneSheet || e.button > 0) return;
    // Anything with its own gesture keeps it. The head is four controls and a
    // title; only the title and the bar around it are the handle.
    if (e.target.closest?.('button, a, select, input, label')) return;
    dragRef.current = { id: e.pointerId, from: e.clientY, y: 0, live: false, at: e.timeStamp, v: 0 };
  }, [phoneSheet]);

  const dragMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.from;
    if (!d.live) {
      if (dy < 6) return;
      d.live = true;
      // Capture so a thumb that slides off the head still finishes the drag —
      // and never at the cost of the drag itself. `setPointerCapture` throws
      // `NotFoundError` for a pointer that is no longer active, which a move
      // event queued behind its own `pointerup` genuinely is; unguarded, that
      // throw abandons the handler with the sheet left translated and
      // `data-drag` still set, which is a sheet stuck half off the screen.
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* uncaptured is still draggable */ }
    }
    // Never upward. The sheet is docked to the bottom edge; lifting it off
    // would show a strip of page under a panel that is supposed to sit on it.
    const y = Math.max(0, dy);
    // Speed over the LAST segment, not over the whole gesture. Averaging from
    // `pointerdown` counts the pause before somebody started moving, so a
    // careful 50px adjustment that happened to begin promptly measured as a
    // flick and threw the sheet away under their thumb.
    d.v = (y - d.y) / Math.max(1, e.timeStamp - d.at);
    d.at = e.timeStamp;
    d.y = y;
    setDrag({ y });
  }, []);

  const dragEnd = useCallback((e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d?.live) { setDrag(null); return; }
    // A flick counts as much as a long pull. Somebody dismissing a sheet
    // throws it at the bottom of the screen and lets go early, and requiring
    // the full distance makes that read as the panel refusing to close.
    // Half a pixel per millisecond is 500px a second — fast enough that
    // nothing but a throw reaches it.
    const flick = d.v > 0.5 && d.y > 40;
    if (d.y > 96 || flick) { setDrag(null); setOpen(false); return; }
    setDrag({ y: 0, releasing: true });
  }, []);

  // Closing hides the panel. Only a clear, logout or idle expiry drops history.
  const newConversation = () => {
    abortRef.current?.abort();
    if (captureRef.current) { captureRef.current.cancelled = true; captureRef.current.controller?.abort(); }
    recorderRef.current?.state === 'recording' && recorderRef.current.stop();
    audioRef.current?.pause();
    clearConversation();
    setQuestion('');
    setTranscribing(false);
    setSpeaking(false);
  };

  // Pinned to the newest turn — and re-pinned when the keyboard resizes the
  // sheet. Without the second dependency the panel keeps its scroll offset
  // while losing half its height, so the answer somebody just asked for
  // scrolls off the top of the log at the exact moment they tap the field to
  // ask the follow-up.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [turns, keyboard.inset, keyboard.height]);

  const assistant = status.capabilities?.find((c) => c.id === 'assistant');
  const offered = Boolean(status.enabled && assistant?.offered);
  const consented = Boolean(assistant?.consented);
  const { animal, name: companionName, roam: roamAllowed, stirs } = resolveCompanion(status.buddy);
  // Everything the person reads says the companion's name when the operator
  // gave it one. The name never reaches the MODEL, though — docs/AI.md §9: the
  // character is visual only, and a persona instruction is something a small
  // model drifts out of halfway through an answer about a refund.
  const called = companionName || 'the assistant';

  /**
   * Speak the answer, if this shop reads answers aloud.
   *
   * The audio is fetched, played from an object URL, and the URL is revoked as
   * soon as playback ends — so the clip exists in the page for exactly as long
   * as it is being heard and is never handed to the browser's HTTP cache. The
   * server sends `Cache-Control: no-store` for the same reason.
   */
  const readAloud = useCallback(async (text) => {
    if (!voice.speak || !text) return;
    const revision = conversationSnapshot().revision;
    const controller = new AbortController();
    audioFetchRef.current?.abort();
    audioFetchRef.current = controller;
    try {
      const res = await powFetch('/ai/voice/speak', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(localStorage.getItem('token') ? { Authorization: `Bearer ${localStorage.getItem('token')}` } : {}),
        },
        body: JSON.stringify({ text: text.slice(0, 2000) }),
        signal: controller.signal,
      });
      if (!res.ok || !openRef.current || controller.signal.aborted || revision !== conversationSnapshot().revision) return;
      const blob = await res.blob();
      if (audioContextRef.current?.state === 'running') {
        try {
          const ctx = audioContextRef.current;
          const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
          if (!openRef.current || controller.signal.aborted || revision !== conversationSnapshot().revision) return;
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          const playback = { pause: () => { try { source.stop(); } catch { /* already ended */ } } };
          audioRef.current = playback;
          source.onended = () => { source.disconnect(); if (audioRef.current === playback) { audioRef.current = null; setSpeaking(false); } };
          setSpeaking(true);
          source.start();
          return;
        } catch { /* Some engines only decode the format through an audio element. */ }
      }
      if (!openRef.current || controller.signal.aborted || revision !== conversationSnapshot().revision) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.addEventListener('pause', () => URL.revokeObjectURL(url), { once: true });
      setSpeaking(true);
      const done = () => { setSpeaking(false); URL.revokeObjectURL(url); audioRef.current = null; };
      audio.addEventListener('ended', done, { once: true });
      audio.addEventListener('error', done, { once: true });
      await audio.play().catch(done);
    } catch { setSpeaking(false); }
    finally { if (audioFetchRef.current === controller) audioFetchRef.current = null; }
  }, [voice.speak]);

  /**
   * Push to talk.
   *
   * Turn-based, not continuous. docs/AI.md §9: barge-in and always-on
   * listening need voice-activity detection, a realtime model and a
   * permanently open microphone — and an always-open microphone is the last
   * thing a privacy-focused storefront should ask for. Holding a button is
   * also the honest interaction: the person knows exactly when it is
   * listening, because it only listens while they hold it.
   *
   * The microphone is requested per turn rather than held between them. The
   * browser remembers the grant, so this is not a prompt every time — but the
   * TRACK is stopped the moment recording ends, which is what turns off the
   * recording indicator in the browser chrome. A page that keeps a live track
   * open between questions is a page that looks like it is always listening,
   * and looking like it is the same problem as being it.
   */
  const startListening = useCallback(async (event) => {
    if (!voice.listen || busy || transcribing || captureRef.current) return;
    // Capture the pointer so sliding a thumb off the small icon still releases
    // this recording. A quick tap toggles dictation; a hold stops on release.
    event?.currentTarget?.setPointerCapture?.(event.pointerId);
    audioFetchRef.current?.abort();
    audioRef.current?.pause();
    setSpeaking(false);
    // Resume during the gesture. Mobile browsers can reject a new audio
    // element played only after the asynchronous answer has arrived.
    if (voice.converse && voice.speak) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioContextRef.current ||= new AudioContext();
        audioContextRef.current.resume().catch(() => {});
      }
    }
    const session = { controller: new AbortController(), revision: conversationSnapshot().revision, started: Date.now(), cancelled: false, stopOnReady: false, autoSend: false };
    captureRef.current = session;
    setListening(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session.cancelled || captureRef.current !== session) {
        stream.getTracks().forEach((t) => t.stop());
        if (captureRef.current === session) captureRef.current = null;
        return;
      }
      session.stream = stream;
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorderRef.current = recorder;
      recorder.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
      recorder.addEventListener('stop', async () => {
        clearTimeout(session.timer);
        stream.getTracks().forEach((t) => t.stop());
        recorderRef.current = null;
        setListening(false);
        if (session.cancelled) { captureRef.current = null; return; }
        const clip = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        chunks.length = 0;
        if (!clip.size) { captureRef.current = null; return; }
        const form = new FormData();
        form.append('audio', clip, 'turn.webm');
        setTranscribing(true);
        try {
          const res = await powFetch('/ai/voice/transcribe', {
            method: 'POST',
            headers: localStorage.getItem('token') ? { Authorization: `Bearer ${localStorage.getItem('token')}` } : {},
            body: form,
            signal: session.controller.signal,
          });
          if (!res.ok || session.cancelled) return;
          const { text } = await res.json();
          if (text && !session.cancelled && conversationSnapshot().revision === session.revision) {
            if (session.autoSend && voice.converse) askRef.current?.(null, text, true);
            else setQuestion(text.slice(0, 500));
          }
        } catch { /* The text input remains available after a failed transcription. */ }
        finally { if (captureRef.current === session) captureRef.current = null; setTranscribing(false); }
      }, { once: true });
      recorder.start();
      session.timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 60000);
      if (session.stopOnReady) recorder.stop();
    } catch {
      session.stream?.getTracks().forEach((t) => t.stop());
      if (captureRef.current === session) captureRef.current = null;
      setListening(false);
    }
  }, [voice.listen, voice.converse, voice.speak, busy, transcribing]);

  const stopListening = useCallback((event) => {
    const session = captureRef.current;
    if (!session) return;
    const held = Date.now() - session.started >= 300;
    if (event?.type === 'pointercancel') session.cancelled = true;
    else if (!held && !session.toggled) { session.toggled = true; return; }
    session.autoSend = !!voice.converse && (held || session.toggled);
    session.stopOnReady = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, [voice.converse]);

  // A hidden microphone must not stay open or submit after its panel closes.
  useEffect(() => {
    if (open) return;
    audioFetchRef.current?.abort();
    if (captureRef.current) { captureRef.current.cancelled = true; captureRef.current.controller?.abort(); captureRef.current.stopOnReady = true; }
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setListening(false);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; setSpeaking(false); }
  }, [open]);
  useEffect(() => () => {
    abortRef.current?.abort();
    audioFetchRef.current?.abort();
    if (captureRef.current) { captureRef.current.cancelled = true; captureRef.current.controller?.abort(); }
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    audioRef.current?.pause();
    audioContextRef.current?.close().catch(() => {});
  }, []);

  /**
   * Send one question and consume the NDJSON stream.
   *
   * `fetch` with a reader rather than EventSource: the server speaks NDJSON
   * over a chunked response (controllers/aiController.js), one event per line,
   * so that the web page and the two bots consume the SAME producer. EventSource
   * would have needed SSE framing that the bots have no use for.
   */
  const ask = useCallback(async (e, override, spoken = false) => {
    e?.preventDefault();
    const revision = conversationSnapshot().revision;
    const current = () => conversationSnapshot().revision === revision;
    const q = (override ?? question).trim().slice(0, 500);
    if (!q || conversationSnapshot().busy) return;

    setQuestion('');
    setTurns((t) => [...t, { who: 'you', text: q }, { who: 'them', text: '', cards: [] }]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    // Accumulated here as well as in state, because `setTurns` is async and
    // the answer is needed the moment the stream ends.
    let answered = '';

    try {
      // The proof of work comes from utils/api rather than being minted here:
      // that module owns the surface list, and a second place that knows how
      // to mint a proof is a second place that will mint it differently.
      // `powFetch` also owns the one retry a 428 earns — which the ladder made
      // load-bearing, because the first request past a free run is refused by
      // design and the client could not have known in advance.
      const token = localStorage.getItem('token');
      const res = await powFetch('/ai/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          question: q,
          // The exchange so far, so "which one?" / "1234" is a conversation
          // rather than two unrelated questions. The server clamps and
          // role-forces this; nothing here is trusted on the far side.
          // `t.text` only — never `t.did`. The shop's confirmations are not
          // the model's words and replaying them as such stops the tools
          // working; the assignment above keeps them in their own field so
          // this cannot pick them up by accident, and this comment is here so
          // nobody later "fixes" the transcript by merging the two.
          history: turns
            .filter((t) => (t.who === 'you' ? t.text : t.text || t.error))
            .slice(-8)
            .map((t) => ({ role: t.who === 'you' ? 'user' : 'assistant', content: t.text })),
          // Where the buyer is, so "is this in stock?" has a referent. IDS
          // ONLY: the server looks every one of them up through the same
          // visibility rules the catalogue uses, and sending the product
          // itself would let a modified client tell the assistant that
          // something exists, or costs something, when it does not. See
          // server/services/ai/pageContext.js.
          page: pageContext(location.pathname),
          // Dropped server-side for a caller the operator has not let near it,
          // so sending it from a stale tab is harmless.
          ...(think ? { thinking: think } : {}),
        }),
        signal: controller.signal,
      });

      if (!current()) return;
      if (!res.ok || !res.body) {
        setReachable(false);
        const message = res.status === 401
          ? 'Sign in to ask the assistant.'
          : 'The assistant is not available right now.';
        setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, error: message } : turn)));
        return;
      }
      setReachable(true);

      // The chunk-boundary buffering this used to do by hand now lives in
      // utils/aiStream, because the staff tools needed the identical loop and
      // the three ways it goes wrong are worth solving once. See that file.
      for await (const event of readNdjson(res)) {
        if (!current()) { controller.abort(); break; }
        if (event.type === 'token') answered += event.text;
        // Read aloud too. A spoken turn whose whole content was "I have put 27
        // in your cart" would otherwise be answered with silence.
        if (event.type === 'action_text') answered += (answered.trim() ? ' ' : '') + event.text;
        // ── A tool changed the cart ──
        //
        // The assistant writes `cart_items` server-side, so this tab's cart —
        // and the count in the navbar two elements away from this animal — is
        // now stale. The card carries the flag rather than this component
        // matching on tool names, because the surface should not have to keep
        // a list of which tools have side effects that reach it: a future tool
        // that touches the cart sets `refresh` and this keeps working.
        if (event.type === 'actions' && event.cards?.some((c) => c.refresh === 'cart')) {
          window.dispatchEvent(new CustomEvent(CART_CHANGED));
        }
        setTurns((t) => t.map((turn, i) => {
          if (i !== t.length - 1) return turn;
          if (event.type === 'token') return { ...turn, text: turn.text + event.text };
          // ── What the SHOP did, kept out of `text` on purpose ──
          //
          // A tool's confirmation is written by the server, not by the model,
          // and it must not come back as the model's own words: the history
          // below is built from `turn.text`, and a previous turn reading "I
          // have put 19 x X in your cart" taught a live gemma4:12b to write
          // another sentence like it instead of calling the tool — every time,
          // for the rest of the conversation, with the cart untouched. See the
          // tool round in server/services/ai/assistant.js for the measurement.
          //
          // It renders immediately under the answer, so a buyer sees no
          // difference. The difference is only in what gets replayed.
          if (event.type === 'action_text') return { ...turn, did: [...(turn.did || []), event.text] };
          // The model's working-out, kept in its own field and never appended
          // to `text`. On a reasoning model this is the ONLY thing arriving
          // for the first stretch — before it existed the buyer watched a
          // thinking animal and an empty bubble for a minute and had no way to
          // tell that from a stalled tunnel.
          //
          // It is never part of the answer: a shop assistant's deliberation
          // restates the retrieval context more bluntly than the reply does,
          // and it is full of false starts. It is offered as working-out that
          // a buyer may open. It expires with the conversation.
          if (event.type === 'thinking') return { ...turn, thinking: (turn.thinking || '') + event.text };
          if (event.type === 'cards') return { ...turn, cards: event.products };
          if (event.type === 'actions') return { ...turn, actions: event.cards };
          if (event.type === 'error') return { ...turn, error: event.message };
          return turn;
        }));
      }
    } catch (err) {
      if (current() && err.name !== 'AbortError') {
        // A proof-of-work failure is NOT the model being unreachable, and the
        // buddy must not say it is: this animal's whole justification is that
        // its state is read from something real, so a sleeping buddy in front
        // of a perfectly healthy model is the one failure that discredits it.
        // The cause is carried on the error (utils/pow.js) precisely because
        // nothing else survives to here — a CSP that refused the worker, no
        // SHA-256 outside a secure context, or a store refusing to issue a
        // challenge are all things the person can act on, and 'the assistant
        // stopped responding' is not.
        if (!err.pow) setReachable(false);
        setTurns((t) => t.map((turn, i) => (
          i === t.length - 1 ? { ...turn, error: err.pow ? err.message : 'The assistant stopped responding.' } : turn
        )));
      }
    } finally {
      if (current()) setBusy(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
    // Read it back, if this shop speaks. Deliberately after the stream has
    // finished rather than sentence by sentence: synthesising a partial answer
    // means synthesising it again when the rest arrives, and a voice that
    // restarts mid-sentence is worse than one that waits a beat.
    if (openRef.current && current() && answered && spoken && voice.converse && !controller.signal.aborted) readAloud(answered);
  }, [question, busy, readAloud, voice.converse, turns]);

  /**
   * Stop the answer that is arriving.
   *
   * There was no way to do this from the panel before: a question that turned
   * out to be the wrong one, or an answer running to a thousand words on a
   * phone, could only be escaped by closing the whole thing — and closing it
   * does not stop the stream either, it just hides it.
   *
   * Aborting the fetch is the whole mechanism. `ask` already treats an
   * `AbortError` as "nobody is waiting for this" rather than as a failure, so
   * no error turn is written; the partial answer stays exactly as far as it
   * got, which is honest about what the shop actually said. `finally` clears
   * `busy`, so the composer comes back on its own.
   */
  const stopAnswer = useCallback(() => { abortRef.current?.abort(); }, []);

  /**
   * Opened from elsewhere on the page — a search that found nothing, an order
   * page — with the question already written. See utils/askAssistant: the two
   * callers are nowhere near this component in the tree, and a DOM event is
   * what a one-way notification carrying a string actually is.
   *
   * The listener is attached whatever the assistant's state, and `ask` does
   * its own gating: a store with the feature off simply shows the panel saying
   * so, which is a better answer than a button that does nothing.
   */
  useEffect(() => {
    const onAsk = (e) => {
      const question = e?.detail?.question;
      if (!question) return;
      setOpen(true);
      ask(null, question);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, [ask]);
  askRef.current = ask;

  const grantConsent = useCallback(async () => {
    try {
      await api.post('/ai/consent/assistant');
      // The cached copy is now wrong about the one field this button changed,
      // and the other instance of this component is holding it too. Drop it
      // before reading, so both animals wake up rather than one.
      invalidateAiStatus();
      setStatus(await getAiStatus() || UNKNOWN);
    } catch { /* the button stays; the person can try again */ }
  }, []);

  /*
   * Which state wins.
   *
   * Real statuses first, and in this order: talking beats thinking beats
   * sleeping. A mouth that moves while sound comes out needs no explaining,
   * and it is the state a person is actually looking at while it happens.
   *
   * The decorative burst only gets a look in when NOTHING real is happening —
   * the companion is awake, idle, and reachable. That single condition is what
   * makes the flourishes safe to have: a hover cannot make a sleeping model
   * look awake, and a greeting cannot cover a generation in progress.
   */
  // The cart and checkout, where §9 rule 1 applies: nothing on those pages may
  // compete with somebody completing a payment. Several things below ask.
  const onCheckout = /^\/(checkout|cart)/.test(location.pathname);

  /*
   * Ranked, and the order is the argument.
   *
   * Speaking and thinking are the assistant doing something; asleep is the
   * assistant unable to. `work` outranks only `idle`, and it sits BELOW
   * `sleep` on purpose: a browser grinding a proof of work for a catalogue
   * search says nothing about whether the model is reachable, and covering an
   * unreachable model with a busy-looking animal is the one direction this
   * status light must never lie in. Everything above `idle` is read from
   * something real, which is what makes the decorative states safe to have.
   *
   * `backgroundState` is the last real thing on the ladder: another status the
   * SURFACE is reporting through the same animal, which on the admin rail is
   * the meaning index sweeping or stalled (AdminCompanion). It ranks below
   * everything the assistant itself is doing, for the reason the whole ladder
   * exists — a job running in the background must never paint over a model
   * this person cannot reach, or over the answer being typed in front of them.
   * It ranks above `idle` because it is read from something real, and that is
   * also what keeps it out of the decorative states below.
   */
  const status_ = speaking ? 'talk'
    : busy ? 'think'
      : !reachable ? 'sleep'
        // Not during checkout. §9 rule 1 outranks explaining a delay.
        : (working && !onCheckout) ? 'work'
          : backgroundState || 'idle';
  const state = status_ === 'idle'
    ? (!stirs || !motion || !visible || onCheckout ? 'still' : burst || (hovered ? 'perk' : 'idle'))
    : status_;

  useEffect(() => {
    if (status_ !== 'idle' || !stirs || !motion || !visible || onCheckout) setBurst(null);
  }, [status_, stirs, motion, visible, onCheckout]);
  useEffect(() => { setBurst(null); }, [animal]);

  const openPanel = () => {
    // The toggle is computed from `open` and the updater does nothing else.
    // The first version queued the greeting INSIDE `setOpen`'s updater, which
    // is an impure updater — React calls those twice in development to catch
    // exactly this, and the second call re-queued a burst against a state that
    // had already moved. The panel came back closed.
    const next = !open;
    setOpen(next);
    // It says hello when you open it, once, and only if it was resting.
    // Opening a panel while the model is down should show a sleeping animal,
    // not a cheerful one.
    if (next && stirs && !onCheckout && status_ === 'idle' && motion) setBurst('greet');
  };

  const label = reachable
    ? `Ask ${called} about the shop`
    : `${companionName || 'The assistant'} is asleep — the shop cannot reach it`;

  /*
   * May it wander right now?
   *
   * Every clause is a rule from docs/AI.md §9 or DESIGN §2, and each one on
   * its own is enough to keep it home:
   *
   *   · the operator has switched roaming on. It is opt-in, and off by
   *     default: decoration that moves on every page of a shop is the
   *     operator's call to make, not this feature's
   *   · there has to BE an animal, and a layer to walk on
   *   · nothing real may be happening — generating, speaking or unreachable
   *     all mean the sprite's state is carrying information, and a status you
   *     have to find first is not a status light
   *   · the panel must be shut; the animal belongs beside what it opened
   *   · not on checkout or payment. Nothing competes with a buyer paying,
   *     and that includes a cat walking past
   *   · not under `prefers-reduced-motion`
   *
   * When any of them turns false the hook snaps the animal home rather than
   * walking it back: whatever switched roaming off matters more than the
   * journey, and a status light that took four seconds to arrive would be a
   * status light nobody trusted.
   */
  const mayRoam = Boolean(
    roamAllowed && animal && nav && !open && !onCheckout
    && status_ === 'idle' && motion && visible,
  );

  const roam = useCompanionRoam({
    // The navbar itself is the bar it walks along; the layer below is the same
    // box, and measuring the layer would deadlock — see `measure` in the hook.
    boundsEl: nav,
    homeRef: buttonRef,
    enabled: mayRoam,
    // A pointer resting on the button holds it there. Hovering is somebody
    // reaching for the control, and an animal that wandered off from under
    // their cursor would be the one moment this is actively annoying.
    paused: hovered,
    speed: speedFor(animal),
    // The teleport's two halves have to meet in the middle, and how long the
    // dissolve takes is the ANIMAL's business — an owl fades at two-thirds the
    // speed of a dog. `framesFor` is the only thing that knows.
    vanishMs: animal ? framesFor(animal, 'vanish').duration * 1000 : undefined,
  });

  // A hover on the button calls it back, and it comes back the fast way.
  // Walking would mean reaching for a control that is not there yet.
  useEffect(() => {
    if (hovered && roam.away) roam.teleportHome();
  }, [hovered, roam.away, roam.teleportHome]);

  // Roaming and the decorative bursts are the same channel — the animal cannot
  // be perking at you from the far end of the bar. Whatever the roam is doing
  // wins while it is away, and the button's own states take over once home.
  /*
   * What this animal can do, read from its own record.
   *
   * This used to be `['owl', 'bat', 'dragon']` written out twice in this
   * file — once to decide whether a walk across the bar was a flight, once to
   * decide whether `flutter` was among its idle bursts. Adding the cuttlefish
   * is exactly the change that updates one of them and forgets the other, so
   * the fact now lives on the animal (`airborne` in sprites.js) and this file
   * asks rather than remembers.
   */
  const traits = animal ? animalFor(animal) : null;
  const spriteState = roam.roamState === 'walk' && traits?.airborne ? 'fly' : roam.roamState || state;

  const lastHabit = useRef(null);
  useEffect(() => {
    // `stirs` is the operator's dial on "still" — a companion that holds its
    // pose and reports status, and does nothing else (utils/companion.js).
    if (!animal || !stirs || status_ !== 'idle' || open || hovered || onCheckout
      || roam.away || burst || !motion || !visible) return undefined;
    let timer;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!document.hidden) {
          const available = [...(traits?.habits || ['look']),
            // A store that never opted into roaming still gets a few pixels of
            // travel; one that did has the whole bar and does not need this.
            ...(roamAllowed ? [] : ['potter'])];
          const moves = available.filter(move => move !== lastHabit.current);
          // Which way it wanders off. A keyframe cannot roll a die.
          setPotterDir(Math.random() < 0.5 ? 1 : -1);
          const next = moves[Math.floor(Math.random() * moves.length)];
          lastHabit.current = next;
          setBurst(next);
        }
        schedule();
      }, (8000 + Math.random() * 12000) * (traits?.tempo || 1));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [animal, stirs, status_, open, hovered, onCheckout, roam.away, roamAllowed, traits, burst, motion, visible]);

  /*
   * Draw the companion once and give it to the service worker.
   *
   * A push notification names its icon by URL and the worker's fallback is a
   * logo file a fresh store has never uploaded — so a store with no logo sent
   * notifications wearing the browser's generic bell. The alternative to a
   * hosted placeholder is to make one: the sprite and the palette are both
   * already here (utils/companionIcon.js), and a canvas turns them into a PNG
   * with no request at all.
   *
   * Once per animal, not per palette change. A re-theme mid-session leaves the
   * worker holding the previous colours until the next load, which is a
   * notification icon a shade out of date rather than a notification without
   * one — and re-encoding a PNG on every theme tick to fix that would cost
   * more than it is worth.
   */
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!animal || !sw) return;
    let disposed = false;
    let icon;
    const sendIcon = () => {
      if (!disposed && icon) sw.controller?.postMessage({ type: 'SET_COMPANION_ICON', dataUrl: icon });
    };
    sw.addEventListener('controllerchange', sendIcon);
    companionPng(animal, { state: 'idle', size: 192 }).then((dataUrl) => {
      icon = dataUrl;
      sendIcon();
    }).catch(() => {});
    return () => { disposed = true; sw.removeEventListener('controllerchange', sendIcon); };
  }, [animal]);

  /*
   * The proof-of-work light.
   *
   * Held back a beat on purpose. Most solves are over in tens of milliseconds
   * — the ladder only bites a caller who has been going hard — and a companion
   * that flickered into a different pose on every autocomplete keystroke would
   * be noise reporting nothing. Half a second of grinding is a delay somebody
   * has noticed; anything shorter is not worth explaining.
   *
   * It is deliberately not scoped to the assistant. The same puzzle is taken
   * out for a catalogue search or a coupon check, the person feels the same
   * pause, and the same animal can account for it.
   */
  useEffect(() => {
    let hold;
    const onPow = (e) => {
      clearTimeout(hold);
      if (e.detail?.active) hold = setTimeout(() => setWorking(true), 500);
      else setWorking(false);
    };
    window.addEventListener('cs:pow', onPow);
    return () => { clearTimeout(hold); window.removeEventListener('cs:pow', onPow); };
  }, []);

  /*
   * The transcript threw itself away, and the companion says so.
   *
   * This is the only decorative state in this file that is triggered by
   * something the person did not do. It earns that by being the one guarantee
   * the feature makes that is otherwise impossible to witness: the inactivity
   * timeout empties the panel, and an empty panel looks exactly like a panel
   * nobody used. A yawn is a thing that happens because time passed, which is
   * the actual reason.
   *
   * The words in the panel are not conditional on the animal. Under
   * `prefers-reduced-motion`, or with the companion set to a plain button, or
   * on a phone where nobody was looking at the navbar — the notice still
   * appears, because it is information and the yawn is only its illustration.
   */
  useEffect(() => {
    if (!conversation.expired) return;
    if (animal && stirs && !onCheckout && status_ === 'idle' && motionAllowed()) setBurst('yawn');
  }, [conversation.expired]);

  // Read. The notice is dismissed when the panel CLOSES rather than when it
  // opens, so somebody who opened it and looked away is still told next time.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) acknowledgeExpiry();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    const celebrate = () => {
      if (animal && stirs && status_ === 'idle' && motionAllowed() && !onCheckout) {
        if (roam.away) roam.teleportHome();
        setBurst('happy');
      }
    };
    window.addEventListener('cs:purchase', celebrate);
    return () => window.removeEventListener('cs:purchase', celebrate);
  }, [animal, stirs, status_, onCheckout, roam.away, roam.teleportHome]);

  /*
   * Something landed in the cart, so it goes and looks at the cart.
   *
   * The conditions are the wander loop's, deliberately: an escort is a walk
   * across the bar and it may not happen for any reason a wander may not.
   * `mayRoam` already carries all of them — the operator's dial, a real status
   * in progress, the panel, checkout, reduced motion — so this asks it rather
   * than repeating the list and getting it wrong later.
   *
   * Only on a surface where there IS a cart icon to walk to. `escortTo`
   * refuses a target it cannot measure, which is what makes calling it from a
   * phone (where the cart lives in the tab bar under the thumb, not on the
   * navigation bar) do nothing at all rather than something odd.
   */
  useEffect(() => {
    if (!mayRoam) return undefined;
    const escort = () => roam.escortTo('[data-nav="cart"]');
    window.addEventListener('cs:cart-add', escort);
    return () => window.removeEventListener('cs:cart-add', escort);
  }, [mayRoam, roam.escortTo]);

  /*
   * Which of the two rendering paths.
   *
   * A store that has not opted into roaming gets exactly what it got before
   * roaming existed: the sprite inside its button, in the ordinary document
   * flow, depending on nothing. Only a store that HAS opted in grows a portal,
   * a measured position and a claim.
   *
   * That split is deliberate rather than tidy-mindedness. The roaming path
   * cannot draw the companion until it has measured the button, so a
   * measurement that failed — a navbar mid-reflow, a Buddy rendered somewhere
   * without one — would mean no companion at all. Making the default path
   * independent of all of it means the failure mode of an opt-in feature is
   * confined to the people who opted in.
   */
  /*
   * The potter travels in CSS and steps in SVG, and the two have to last
   * exactly as long as each other or the animal slides home with its feet
   * still. Only `framesFor` knows how long that is — it is the frame count
   * times the tick times this animal's tempo — so the component hands the
   * stylesheet the answer rather than either of them guessing. Same trade as
   * `vanishMs` above, for the same reason.
   */
  const potterStyle = animal ? {
    '--potter-dur': `${framesFor(animal, 'potter').duration}s`,
    '--potter-dir': potterDir,
  } : undefined;

  const roaming = Boolean(roamAllowed && animal && nav && roam.owns);

  /*
   * The admin's panel hangs off the rail instead of dropping out of the button.
   *
   * `.admin-sidebar` is `overflow-y: auto`, and an element that scrolls in one
   * axis clips the other — so the ordinary absolutely-positioned popover was
   * cut off at the rail's edge, at a width (26rem) more than twice the rail's.
   * Docking it means the same portal the phone sheet already takes, for the
   * same reason: the panel belongs at body level, not inside a scroll box.
   *
   * Not on a phone. There the sheet is already the right shape and already
   * portalled, and the two must not both claim the position — `phoneSheet`
   * mirrors the 640px query in 100-ai-buddy.css, and the dock's own rules sit
   * above that query in the same file.
   */
  const docked = variant === 'admin' && !phoneSheet;

  // The rail's row is a line of 10px uppercase text with a status word in it,
  // and a 32px animal beside that reads as a mascot pasted into a header
  // rather than the light it is. The navbar's own size is unchanged.
  const spriteSize = variant === 'admin' ? 24 : 32;

  // Absent, not hidden: a store that does not offer an assistant should have
  // no assistant-shaped hole in its navbar.
  //
  // This is the ONLY early return, and it has to stay below every hook above
  // it. React counts hooks per render, so a `return null` in the middle is
  // exactly the "rendered more hooks than during the previous render" crash —
  // and it fires on the first status read rather than on the render that
  // introduced it, which is why it is worth a comment rather than a blank line.
  if (!offered) return null;

  /*
   * The panel is built here rather than inline in the tree below, because
   * WHERE it is rendered depends on the viewport — see the portal in the tree.
   */
  /*
   * What the head's dot and its word are saying, worked out once.
   *
   * Every branch is read from something real, which is the same rule the
   * animal in the navbar follows and for the same reason: a panel that said
   * "ready" over an unreachable model would discredit the light beside it.
   */
  const panelState = listening ? 'listening'
    : transcribing ? 'transcribing'
    : !reachable ? 'asleep'
      : busy ? 'thinking'
        : 'ready';

  const panel = open ? (
    <div
      className={`buddy-panel${variant === 'admin' ? ' buddy-panel-admin' : ''}${docked ? ' buddy-panel-dock' : ''}`}
      ref={panelRef}
      role="dialog"
      aria-label={`Ask ${called} about the shop`}
      /*
       * The keyboard's geometry, handed to the stylesheet rather than acted on
       * here. Both are zero-or-absent on the desktop path and on any engine
       * without `visualViewport`, and the phone block's `max()` and fallbacks
       * are written so that case is the behaviour this panel already had.
       *
       * `data-kb` is the same fact as a boolean, because one rule needs it as
       * a switch rather than as a length — see the ask row's safe-area padding
       * in 100-ai-buddy.css.
       */
      data-kb={keyboard.inset > 0 ? 'true' : undefined}
      /* How far down the finger has taken the sheet, and whether it has let
         go. The stylesheet turns the first into a transform and the second
         into the spring back. */
      data-drag={drag ? (drag.releasing ? 'release' : 'true') : undefined}
      style={{
        '--buddy-kb': `${keyboard.inset}px`,
        ...(keyboard.height ? { '--buddy-vv': `${keyboard.height}px` } : null),
        ...(drag ? { '--buddy-drag': `${drag.y}px` } : null),
      }}
    >
      <div
        className="buddy-head"
        onPointerDown={dragStart}
        onPointerMove={dragMove}
        onPointerUp={dragEnd}
        onPointerCancel={dragEnd}
      >
        {/* The sheet's handle. Drawn only on the phone (100-ai-buddy.css), and
            it really does drag — see the pointer handlers above. */}
        <span className="buddy-grip" aria-hidden="true" />
        <div className="buddy-head-row">
          <span className="buddy-head-id">
            {/*
              The state, as a dot and a word in one object.

              `role="status"` so a screen reader is told when the assistant
              starts thinking or the model goes away, which is the whole point
              of the light and was previously announced to nobody.
            */}
            <span className="buddy-state" data-state={panelState} role="status">
              <span className="buddy-dot" aria-hidden="true" />
              <span className="sr-only">{`The assistant is ${panelState}.`}</span>
            </span>
            <span className="buddy-head-title">
              {companionName ? `Ask ${companionName}` : 'Ask about the shop'}
            </span>
            {/* The word the dot is saying, beside the name rather than over by
                the tools: identity and state on the left, controls on the
                right, so a glance at either half gets one kind of answer.
                `aria-hidden` because the dot above it already carries this
                sentence to a screen reader, and twice is worse than once. */}
            <span className="buddy-state buddy-state-word" data-state={panelState} aria-hidden="true">
              {panelState}
            </span>
          </span>
          <div className="buddy-tools">
            {/*
              The per-request thinking dial, when this viewer is allowed one.
              Beside the status rather than under the input because it
              describes how the NEXT answer will be produced, which is the same
              thing the status word is about.

              The value is DRAWN and the `<select>` is a transparent sheet over
              it — see `.buddy-dial` in 100-ai-buddy.css. A native select sizes
              to its widest option, so the old one needed a `max-width` to stop
              it eating the head, and the width it got clipped the value it was
              displaying: "think: default" rendered as "think: defa".
            */}
            {status.thinking_toggle && (
              <span
                className="buddy-dial"
                title="How hard to think about the next question. Deeper answers take longer."
              >
                <Brain size={13} aria-hidden="true" />
                <span aria-hidden="true">{think || 'default'}</span>
                <ChevronDown size={11} aria-hidden="true" />
                <select
                  className="buddy-dial-select"
                  aria-label="Thinking depth for the next question"
                  value={think}
                  onChange={(e) => setThink(e.target.value)}
                  disabled={busy}
                >
                  <option value="">default</option>
                  {(status.thinking_levels || ['off', 'low', 'medium', 'high']).map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </span>
            )}
            {user && (
              <Link
                to="/profile#ai-data"
                className="buddy-tool"
                title="Your AI data"
                aria-label="Your AI data"
                onClick={() => setOpen(false)}
              >
                <ShieldCheck size={16} />
              </Link>
            )}
            <button
              type="button"
              className="buddy-tool"
              onClick={newConversation}
              title="New conversation"
              aria-label="New conversation"
            >
              <RotateCcw size={16} />
            </button>
            {/*
              A way out that is not "tap the page behind it".

              Only on the sheet. The desktop popover is a small object beside
              the button that opened it, and clicking anywhere — including that
              button — shuts it; the sheet covers the bottom of the screen with
              the keyboard over what is left, so on a phone the nearest patch
              of "outside" can genuinely be a strip of page above the panel.
              Rendered from `phoneSheet` rather than hidden by a media query so
              it is not a control screen readers announce on a surface that
              does not have it.
            */}
            {phoneSheet && (
              <button
                type="button"
                className="buddy-tool"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X size={17} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="buddy-log" ref={logRef}>
        {!consented && (
          // The person's own gate. docs/AI.md §5: nothing is on for a new
          // account, and "the operator turned it on for the shop" is not
          // the same as being asked.
          //
          // Its own shape rather than a borrowed answer bubble: this is the
          // store asking permission, and dressing it as something the
          // assistant said would be the one place in the panel where the
          // speaker is misattributed.
          <div className="buddy-gate">
            <p>
              {assistant?.what || 'This shop can answer questions about its products and how it works.'}
            </p>
            <p>
              Your conversation stays in this browser tab until you clear it, sign out, or the inactivity timeout expires.
            </p>
            <button type="button" className="glass-btn glass-btn-sm glass-btn-primary" onClick={grantConsent}>
              Turn it on
            </button>
          </div>
        )}

        {consented && conversation.expired > 0 && turns.length === 0 && (
          /*
           * Why the panel is empty. The companion yawns at the same moment
           * (see the expiry effect above), and this is the half that does not
           * depend on anybody having been looking at it — or on there being a
           * companion at all, since "none" is a real answer to that setting.
           *
           * It names the timeout rather than saying "cleared", because the
           * timeout is the operator's number and a buyer who thinks the store
           * ate their conversation is owed the reason it did.
           */
          <div className="buddy-note">
            The last conversation cleared itself after {idleMinutes} minute{idleMinutes === 1 ? '' : 's'} of
            quiet. It was only ever in this tab, so there is nothing to delete.
          </div>
        )}

        {consented && turns.length === 0 && (
          <div className="buddy-note">
            <p>Ask about a product, or about how this shop works.</p>
            {/* Follows the page, because the assistant does too: the buddy
                already tells the server where it is, and offering somebody on
                a product page the chance to ask about their membership tier
                wastes the one hint they get. See utils/suggestedQuestions.

                Drawn as rows rather than as chips: four questions of four
                different lengths laid out as pills is four ragged edges, and
                every one of them is the same gesture — tap the line, go
                somewhere. One shape for one gesture. */}
            {status.suggested_questions !== false && (
              <div className="buddy-suggestions">
                {suggestedQuestions(pageContext(location.pathname), {
                  signedIn: Boolean(user),
                  // Inside the console, and staff: the operational questions
                  // instead of the buyer ones. The path is passed separately
                  // from `page` because the hint list groups the console into
                  // six desks while `pageContext` names each page — see
                  // `suggestedQuestions`. Either way the list is chosen in the
                  // browser and the server receives nothing but whichever
                  // question gets pressed.
                  adminPath: (user?.role === 'admin' || user?.role === 'manager')
                    ? location.pathname
                    : null,
                })
                  .map((q) => (
                    <button type="button" className="buddy-row buddy-suggest" key={q} onClick={() => ask(null, q)}>
                      <span>{q}</span>
                      <ChevronRight className="buddy-row-arrow" size={14} aria-hidden="true" />
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}

        {turns.map((turn, i) => (
          /*
           * One turn is a COLUMN, and the bubble, the working-out, the error
           * and the cards are siblings inside it.
           *
           * They used to be children of the turn's own box, which made a
           * product card a card inside a bubble inside a panel — three nested
           * claims that something is a discrete object, of which docs/DESIGN.md
           * §1 says two are false.
           */
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className={`buddy-turn ${turn.who === 'you' ? 'buddy-turn-you' : 'buddy-turn-them'}`}>
            {turn.who === 'you' ? <div className="buddy-bubble">{turn.text}</div> : (
              <>
                {/* The working-out, when the shop's model produces any.
                    Above the answer because that is the order it happened
                    in, and open only while there is no answer yet: a
                    reasoning model emits nothing else for the first
                    stretch, so this is what stands between a buyer and a
                    blank bubble. It shuts itself the moment real words
                    start, because by then the answer is the thing to
                    read. */}
                {turn.thinking && (
                  <details className="buddy-thinking" open={!turn.text}>
                    <summary>{called} is working it out</summary>
                    <p aria-hidden="true">{turn.thinking}</p>
                  </details>
                )}
                {turn.text ? <div className="buddy-bubble">{turn.text}</div> : null}
                {/* The shop's own sentences about what it just did. Same
                    bubble treatment as the answer, because to the person
                    reading it this IS part of the reply — it is only the
                    replay that has to tell them apart. */}
                {turn.did?.length > 0 && (
                  <div className="buddy-bubble buddy-did">{turn.did.join(' ')}</div>
                )}
                {/* Nothing has arrived yet. Without this the panel drew an
                    empty box under the question and left it there for as long
                    as the model took — which on a reasoning model with the
                    working-out switched off is the whole wait. */}
                {!turn.text && !turn.did?.length && !turn.error && busy && i === turns.length - 1 && (
                  <div className="buddy-bubble buddy-typing">
                    <i aria-hidden="true" />
                    <i aria-hidden="true" />
                    <i aria-hidden="true" />
                    <span className="sr-only">{`${called} is answering.`}</span>
                  </div>
                )}
                {/* What the shop did or found, as one card shape: what
                    changed, where to undo it, or the table it computed. See
                    ResultCard for why a link was not enough. */}
                {turn.actions?.length > 0 && <div className="buddy-cards">
                  {turn.actions.map((card) => <ResultCard key={card.id} card={card} onNavigate={() => setOpen(false)} />)}
                </div>}
                {turn.error && (
                  <div className="buddy-alert">
                    <AlertTriangle size={15} aria-hidden="true" />
                    <span>{turn.error}</span>
                  </div>
                )}
                {turn.cards?.length > 0 && (
                  <div className="buddy-cards">
                    {turn.cards.map((p) => {
                      const cited = p.variants.filter((v) => v.cited);
                      const shown = (cited.length ? cited : p.variants).slice(0, 3);
                      return (
                        <Link key={p.id} to={`/products/${p.id}`} className="buddy-row buddy-card" onClick={() => setOpen(false)}>
                          <div className="buddy-card-name">{p.name}</div>
                          {p.brand && <div className="buddy-card-brand">{p.brand}</div>}
                          {shown.map((v) => (
                            <div key={v.id}>
                              <div className="buddy-card-variant">
                                <span className={v.inStock ? undefined : 'buddy-card-out'}>{v.name}</span>
                                {/* Straight from the API, which read it live
                                    from Postgres. The model never saw it. */}
                                <span>{v.inStock ? v.price : 'out of stock'}</span>
                              </div>
                              {/* What reviewers said, counted by the shop —
                                  the product page's own evidence chips, here
                                  on the card that recommends the product. */}
                              {Array.isArray(v.evidence) && v.evidence.length > 0 && (
                                <div className="buddy-card-evidence">
                                  {v.evidence.map((e) => (
                                    <span
                                      key={e.label}
                                      className="buddy-card-chip"
                                      title={`${e.supporting} of ${e.of} reviewers used the word "${e.label}"`}
                                    >
                                      {e.supporting} of {e.of} said {String(e.label).toLowerCase()}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {consented && (
        /*
         * Field, microphone, send: three controls, one height.
         *
         * They are all `--control-h` now, which 01-tokens.css already raises
         * to `max(44px, …)` on a coarse pointer — so the touch floor is what
         * the row IS rather than a media query patching a 37px field standing
         * between two 29px buttons.
         */
        <form className="buddy-ask" onSubmit={ask}>
          <div className="buddy-field">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Something fruity that is in stock?"
              maxLength={500}
              disabled={busy || transcribing}
              aria-label="Your question"
            />
          </div>
          {voice.listen && (
            <button
              type="button"
              className={`glass-btn buddy-mic${listening ? ' buddy-mic-live' : ''}`}
              // Press and HOLD. Pointer events rather than mouse, so a
              // thumb works the same as a cursor; `onPointerLeave` stops it
              // too, because a finger that slides off the button has let go.
              onPointerDown={startListening}
              onPointerUp={stopListening}
              onPointerCancel={stopListening}
              disabled={busy || transcribing}
              aria-label={listening ? 'Listening — release a hold or tap to stop' : voice.converse ? 'Tap or hold to talk and send' : 'Tap or hold to dictate'}
              title={voice.converse ? 'Speak and send' : 'Dictate into the text field'}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!captureRef.current) startListening(); } }}
              onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); stopListening(); } }}
              onContextMenu={(e) => e.preventDefault()}
            >
              {/* A real icon, not an emoji. docs/DESIGN.md §1 lists emoji
                  as iconography among the tells that a surface was not
                  designed — and a microphone glyph that renders differently
                  on every platform is exactly the kind of thing that makes
                  one control look unlike every other control beside it. */}
              {listening && <span className="buddy-listening-orb" role="status"><Mic size={24} /><span className="sr-only">Listening</span></span>}
              {listening ? <Square size={14} fill="currentColor" /> : <Mic size={16} />}
            </button>
          )}
          {/*
            While an answer is arriving the send button IS the stop button.
            One slot, so the row does not change width mid-answer, and the
            control that was a dead '…' now does the one thing somebody
            watching a long answer wants.
          */}
          {busy ? (
            <button
              type="button"
              className="glass-btn buddy-send buddy-stop"
              onClick={stopAnswer}
              title="Stop this answer"
              aria-label="Stop this answer"
            >
              <Square size={11} fill="currentColor" aria-hidden="true" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="glass-btn glass-btn-primary buddy-send"
              disabled={transcribing || listening || !question.trim()}
            >
              Ask
            </button>
          )}
        </form>
      )}
    </div>
  ) : null;

  return (
    <div className="buddy-root" ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className={`buddy-button${variant === 'admin' ? ' buddy-button-admin' : ''}`}
        ref={(el) => {
          buttonRef.current = el;
          // `.navbar` is the containing block the layer needs; a Buddy rendered
          // outside one (a future panel, a story) simply never roams.
          if (el && !nav) setNav(el.closest('.navbar'));
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={openPanel}
        onPointerEnter={() => setHovered(true)}
        onPointerMove={follow}
        onPointerLeave={() => { setHovered(false); resetAttention(); }}
        onFocus={() => setHovered(true)}
        onBlur={() => { setHovered(false); resetAttention(); }}
        title={label}
        style={potterStyle}
        data-away={roam.away ? 'true' : undefined}
      >
        {/*
          While roaming, the sprite lives in the layer below so it can walk
          behind the icons — and the button keeps its SIZE, because the
          navbar's layout must not depend on where the animal is standing. An
          aria-hidden placeholder does that.

          The accessible name is on the BUTTON in both paths, and the sprite is
          decorative in both. Naming the image as well would announce the same
          sentence twice, and only on the store that switched roaming off.
        */}
        {animal
          ? (roaming
            ? <span className="buddy-perch" style={{ width: 32, height: 32 }} aria-hidden="true" />
            : (
              <BuddySprite
                key={`${animal}-${state}`}
                animal={animal}
                state={state}
                attention={state === 'perk' && motion ? attention : 0}
                size={spriteSize}
                onDone={() => setBurst(null)}
              />
            ))
          : <span style={{ fontSize: 'var(--fs-xs)', padding: '0 0.4rem' }}>Ask</span>}
        <span className="sr-only">{label}</span>
      </button>

      {roaming && createPortal(
        <div className="buddy-roam" ref={layerRef} aria-hidden="true">
          <div
            className="buddy-roam-body"
            data-act={roam.roamState || (roam.away ? 'away' : 'home')}
            data-facing={roam.facing}
            style={{
              ...potterStyle,
              '--buddy-x': `${roam.x ?? 0}px`,
              '--buddy-dur': `${roam.dur}ms`,
              // Hidden until the button has been measured, or it would appear
              // at the left edge of the bar for one frame on every page load.
              visibility: roam.x === null ? 'hidden' : undefined,
            }}
          >
            <BuddySprite
              // Remounted per state so a second greeting actually replays
              // rather than joining the one already running.
              key={`${animal}-${spriteState}`}
              animal={animal}
              state={spriteState}
              attention={spriteState === 'perk' && motion ? attention : 0}
              size={32}
              onDone={() => setBurst(null)}
            />
          </div>
        </div>,
        nav,
      )}

      {/*
        On a phone the panel is a sheet on the bottom edge, and it has to be
        PORTALLED out of the navbar to be one. `.navbar` carries a
        `backdrop-filter`, which makes it a containing block for fixed
        descendants — so `position: fixed; bottom: 0` on a panel rendered
        inside it resolved against the 66px bar rather than the viewport, and
        the sheet hung upwards off the top of the screen with everything above
        the ask field (the whole consent notice, on a first visit) cut off.

        Note that the containing block cannot be relied on in EITHER direction:
        `forced-colors` strips the bar's backdrop-filter entirely
        (03-accessibility-overrides.css), which would move the panel back to
        the viewport. Only being outside the bar is stable. That is already the
        convention next door — `.mobile-backdrop` and `.mobile-tabbar` are
        siblings of `<nav>` in Layout/Navbar.jsx for the same reason.

        Desktop keeps the plain inline path: absolutely positioned against
        `.buddy-root`, measuring nothing, dependent on nothing.
      */}
      {panel && (phoneSheet || docked ? createPortal(panel, document.body) : panel)}
    </div>
  );
}
