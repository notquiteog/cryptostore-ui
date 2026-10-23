import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../../utils/api';
import { invalidateAiStatus } from '../../utils/aiStatus';
import toast from 'react-hot-toast';
import {
  Sparkles, Power, Server, Database, Mic, Volume2, ShieldCheck, Gauge, RefreshCw, PawPrint, AlertTriangle, Brain, BookLock,
  ClipboardCheck,
} from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';
import AskAbout from '../../components/admin/AskAbout';
import { reportSettingsError } from '../../utils/settingsConflict';
import SettingsConflict from '../../components/admin/SettingsConflict';
import useSettingsWatch from '../../hooks/useSettingsWatch';
import SaveBar from '../../components/admin/SaveBar';
import CompanionCard from '../../components/ai/CompanionCard';
import EmbeddingMaintenance from '../../components/ai/EmbeddingMaintenance';
import AssistantTestPanel from '../../components/ai/AssistantTestPanel';
import SmokeRunPanel from '../../components/ai/SmokeRunPanel';
import CompanionPicker from '../../components/ai/CompanionPicker';
import UsageChart from '../../components/admin/ai/UsageChart';
import NextStops from '../../components/admin/NextStops';

/**
 * The AI panel: what this shop offers, which machine answers, and what it is
 * costing.
 *
 * ── The page carries no copy of the registry ────────────────────────────────
 *
 * Same rule as `Limits.jsx`, and for the same reason its comment gives: the
 * schema, the current values and the health of every service all arrive from
 * `GET /ai/settings`, which reads `server/config/aiKeys.js` — the one source
 * the validation, the defaults and the enforcement already use. A second copy
 * here is how a control ends up on screen with nothing behind it.
 *
 * ── Why the health probes are at the top ────────────────────────────────────
 *
 * Because "is it working" is the question an operator actually opens this page
 * with, and every one of the four services can be down independently: the
 * model, the vector store, dictation, speech. A page that made you scroll past
 * thirty settings to find out the tunnel had dropped would be a page nobody
 * uses for the thing it is for.
 */

/**
 * The three model slots, and the key each one is stored under.
 *
 * The server classifies every model it finds into these same slot names
 * (`provider.slotsFor`), so this map is the whole of the client's knowledge
 * about which list belongs in which box. It is deliberately not a copy of the
 * registry: the LABEL, the hint and the bounds still come from `/ai/settings`
 * like every other field on this page.
 */
const MODEL_SLOTS = {
  ai_chat_model: 'chat',
  ai_fast_model: 'fast',
  ai_embed_model: 'embed',
};

/**
 * The five settings one endpoint owns, in the order they are read.
 *
 * Shape, then address, then key, then the two decisions about how the wire is
 * opened. The two switches come last and together on purpose: a certificate
 * rule and a Tor route are the same kind of choice — how this shop reaches
 * that machine — and separating them across a page is how an operator ends up
 * believing one of them covers the other.
 */
const ENDPOINT_FIELD_ORDER = ['provider', 'url', 'key', 'tls_insecure', 'route'];

/**
 * What each connection is for, in one line above its fields.
 *
 * Keyed by endpoint id and falling back to a generic line, so an endpoint
 * added on the server appears here with a sensible card rather than an empty
 * one — and adding a better sentence for it later is a change in this object
 * alone.
 */
const ENDPOINT_BLURBS = {
  llm: 'The model that writes — the assistant, descriptions, support drafts, translation. Point it at this box, at a rented GPU, or at Anthropic; the shop only needs an address and a shape.',
  embed: 'Turns text into vectors for meaning search. Usually the same Ollama as the language model, which is what the default says — but it can be its own machine, and it must be when the language model is Anthropic, which cannot embed.',
  stt: 'Dictation: a spoken question turned into text. A voice is the most identifying thing this shop can hold, so this connection is configured separately from every other one and shares nothing with them.',
  tts: 'Reads answers aloud. Independent of dictation — a shop can have either, both, or neither.',
};

const GROUPS = [
  {
    id: 'connection',
    label: 'The master switch',
    icon: Power,
    hint: 'One switch above everything below it. Off means no capability runs, no route answers, and nothing is sent to any of the servers on this page.',
    keys: ['ai_enabled'],
  },
  {
    id: 'models',
    label: 'Which models',
    icon: Sparkles,
    hint: 'Three slots, not one per feature. The fast slot is for the constant cheap work and falls back to the chat model when blank — worth setting when you pay by the token. The lists are what the server answering at the URL above actually holds, asked for fresh each time this page loads. Embeddings can come from a different server than chat does, which is what makes a chat provider that cannot embed — Anthropic — usable without losing meaning search.',
    keys: ['ai_chat_model', 'ai_fast_model', 'ai_embed_model', 'ai_search_floor', 'ai_allow_thinking'],
  },
  {
    id: 'store',
    label: 'Vector store',
    icon: Database,
    hint: 'Qdrant holds the meaning index. It is derived entirely from your catalogue, so losing it costs a re-index rather than data.',
    keys: ['ai_qdrant_url', 'ai_qdrant_key'],
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: Mic,
    hint: 'Dictation and speech are separate services and either can be left off. A voice is the most identifying thing this shop could hold; no audio is written to disk at any point — but a hosted dictation service receives every clip, so a whisper on your own hardware is the private choice. The model names matter only to a hosted service; the bundled whisper and Kokoro ignore them.',
    keys: ['ai_stt_model', 'ai_tts_model', 'ai_tts_voice'],
  },
  {
    id: 'limits',
    label: 'Cost and reach',
    icon: Gauge,
    hint: 'What the shop is willing to spend, and who may spend it.',
    // The two cost RATES sit with the ceiling rather than in a group of their
    // own: they answer the same question from two directions — how much am I
    // willing to spend, and what is a token worth here. Set together, read
    // together, and the usage chart below the page reports in the unit they
    // define.
    // No model-residency keys here any more. `ai_keep_alive`,
    // `ai_wipe_after_use` and `ai_wipe_idle_seconds` were in this group and
    // are gone: how long a model stays in memory is the model HOST's setting
    // (OLLAMA_KEEP_ALIVE, or a Modelfile), not a box on this page that two of
    // the three supported providers ignored. See docs/AI.md §2a.
    keys: ['ai_daily_token_cap', 'ai_cost_prompt_per_mtok', 'ai_cost_completion_per_mtok', 'ai_anon_allowed', 'ai_conversation_idle_minutes', 'ai_suggested_questions'],
  },
  {
    id: 'conduct',
    label: 'What it may read, say and remember',
    icon: BookLock,
    hint: 'Decisions that are about the shop rather than about the model, which is why each is off (or blank) until an operator makes it. None of them are undone by turning a capability off later — they govern what the assistant is allowed to reach for while it is on.',
    keys: ['ai_index_lab_results', 'ai_publish_sales_counts', 'ai_dispatch_note', 'ai_support_deflect',
      'ai_chat_first_responder', 'ai_chat_reply_assist', 'ai_memory_inferred'],
  },
  {
    id: 'checks',
    label: 'Keeping it honest',
    icon: ClipboardCheck,
    hint: 'The assistant\'s test-question list, run by itself once a day so a topic that breaks on a Tuesday is found on Tuesday. Off until you name an account and switch it on: it spends about thirty questions of inference a day, and it asks as somebody — the account-bound questions read that account\'s own cart and orders, which is why the answers are never kept. The results panel is at the bottom of this page.',
    keys: ['ai_smoke_enabled', 'ai_smoke_account', 'ai_smoke_hour'],
  },
  {
    id: 'thinking',
    label: 'How hard it thinks',
    icon: Brain,
    hint: 'A dial per capability, because the question is never "is thinking worth it" but "is this job a blank page". A support draft or a product description is one, and deliberation shows. An assistant answer is not — retrieval ranked the products and the engine priced them, so the model is narrating facts it was handed, and thinking there bought the same answer 145 times slower. Whatever a dial says, thinking tokens are generated, billed, and counted against the daily cap above.',
    // Only `ai_thinking_toggle` is named. The `ai_think_<capability>` dials
    // are generated per capability on the server, so this page gathers them
    // from the schema instead of keeping a second list — see `groups` in the
    // component. The toggle comes last because its hint says "the defaults
    // above", which is only true while it sits under them.
    keys: ['ai_thinking_toggle'],
  },
  {
    id: 'buddy',
    label: 'What the companion may surface',
    icon: Volume2,
    hint: 'The badge always says THAT something is waiting, never what — a mascot announcing "your order shipped" on a shared screen is a leak with a face on it. Promotions are a separate switch from alerts on purpose: a buyer may legitimately want restock notices and no marketing.',
    // `ai_buddy_sprite`, `ai_buddy_choice` and `ai_buddy_name` are NOT here.
    // They get their own section with a live preview, because a text box that
    // wants the string "axolotl" is not a way to choose an animal, and because
    // the whole argument for the companion is that its states mean something —
    // which an operator can only check by watching them.
    keys: ['ai_buddy_alerts', 'ai_buddy_promos'],
  },
];

export default function AiSettings() {
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  // What the model server actually holds. `null` while the poll is in flight,
  // which is what the slot fields fall back to a plain text box for — see
  // ModelField. Kept apart from `data` on purpose: the poll is a round trip per
  // model at the far end of whatever the operator's URL points at, and the
  // page must not wait on it to draw.
  const [catalogue, setCatalogue] = useState(null);
  const [polling, setPolling] = useState(false);
  /* What the CHOSEN model cannot do, and how much of today's budget is gone.
   *
   * Both come from `GET /ai/health`, and this is its only caller — which is
   * why the warning block below rendered nothing for as long as it has
   * existed. The block reads `data.health.warnings`, `data.health` is
   * `provider.health()`, and `health()` returns `{ ok, reason, models,
   * provider, baseUrl }`. Only the `/ai/health` ROUTE adds the warnings on
   * top, and nothing on this page was asking it. So the one thing `CLAUDE.md`
   * says must never happen silently — a model without `tools` that answers
   * questions and never sets an alert — was failing silently, past a block
   * written to say so.
   *
   * Its own request rather than another field on `/ai/settings`, for the
   * reason `aiController.models` gives about itself: `modelWarnings()` is a
   * per-model `/api/show` round trip at the far end of whatever the
   * operator's URL points at, and the settings call is what this page waits
   * on to draw ANYTHING. Hanging a probe off it would make a slow tunnel look
   * like a broken admin panel. Same shape as `catalogue` above, same reason.
   */
  const [probe, setProbe] = useState(null);
  /* ── A colleague got there first ──
   *
   * Per-key, like the rate limits page and for the same reason: these are
   * eighty independent switches, addresses and model names, and resolving one
   * of them must not discard the other seven somebody had typed.
   *
   * `edits` is the draft and `byKey[...].value` is the baseline, so taking
   * theirs means dropping the key out of `edits` — the field falls back to what
   * the server said, which is now their value. Keeping mine leaves the edit in
   * place; the next Save carries it with a baseline the server will accept,
   * which `load()` below refreshes. Neither writes on its own.
   */
  const [conflicts, setConflicts] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get('/ai/settings'));
      setEdits({});
    } catch (err) {
      toast.error(err.message || 'Could not read the AI settings');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Ask the server what it has.
   *
   * Its own call, and its own button, because the answer goes stale for
   * reasons this page never sees: `ollama pull` in another terminal is the
   * ordinary way a new model arrives, and re-reading the whole settings page
   * to notice it would be the wrong shape of refresh.
   */
  const pollModels = useCallback(async () => {
    setPolling(true);
    try {
      const [llm, embed] = await Promise.all(['llm', 'embed'].map(async (endpoint) => {
        try { return await api.get(`/ai/models?endpoint=${endpoint}`); }
        catch (err) { return { ok: false, reason: err.message, models: [] }; }
      }));
      setCatalogue({ llm, embed });
    } catch (err) {
      // The endpoint answers `{ ok: false, reason }` rather than throwing, so
      // reaching here means the request itself failed. Say so in the same
      // shape, and the fields degrade to text boxes exactly as they do when
      // the model server is down.
      setCatalogue({ llm: { ok: false, reason: err.message, models: [] }, embed: { ok: false, reason: err.message, models: [] } });
    } finally {
      setPolling(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { pollModels(); }, [pollModels]);
  /* Fired once, and never allowed to fail the page. `/ai/health` answers
   * `{ ok: false, reason }` rather than throwing, so a rejection here means
   * the request itself did not land — and a warning nobody could fetch is
   * silence, which is the state this page was already in. */
  useEffect(() => {
    let cancelled = false;
    api.get('/ai/health')
      .then((h) => { if (!cancelled) setProbe(h); })
      .catch(() => { if (!cancelled) setProbe(null); });
    return () => { cancelled = true; };
  }, []);

  const byKey = useMemo(
    () => Object.fromEntries((data?.settings ?? []).map((s) => [s.key, s])),
    [data],
  );

  const valueOf = (key) => (key in edits ? edits[key] : byKey[key]?.value ?? '');

  // Every key on the page, not only the edited ones: a colleague changing a
  // model name this operator has not touched still makes the page stale.
  const watch = useSettingsWatch(useMemo(() => (data?.settings ?? []).map((spec) => spec.key), [data]));

  const takeTheirs = (c) => {
    setEdits((e) => { const next = { ...e }; delete next[c.key]; return next; });
    setConflicts((cur) => cur.filter((x) => x.key !== c.key));
    // Re-read so the field shows their value rather than the stale one the
    // draft was masking.
    load();
  };

  const keepMine = (c) => {
    setConflicts((cur) => cur.filter((x) => x.key !== c.key));
    // The baseline this page sends comes from `byKey`, which `load()` refreshes
    // — so the next Save carries the edit against what is actually stored.
    load();
  };

  /* Which of this page's fields are secrets.
   *
   * Read off the schema the server sent rather than listed here: `/ai/settings`
   * marks a secret by returning `''` for its value and a `configured` flag
   * instead, which is exactly the shape that makes a baseline meaningless for
   * them — see the note in `save`. */
  const AI_SECRET_KEYS_ON_PAGE = useMemo(
    () => new Set((data?.settings ?? []).filter((spec) => spec.configured !== undefined).map((spec) => spec.key)),
    [data],
  );

  // Every setting that belongs to a connection, gathered under its endpoint
  // and put in a fixed order. `useMemo` because this runs on every keystroke
  // in any field on the page.
  const endpointCards = useMemo(() => {
    const specs = data?.settings ?? [];
    const order = new Map();
    for (const spec of specs) {
      if (!spec.endpoint) continue;
      if (!order.has(spec.endpoint)) order.set(spec.endpoint, []);
      order.get(spec.endpoint).push(spec);
    }
    return [...order.entries()].map(([id, rows]) => ({
      id,
      // The endpoint's own name, taken off its settings rather than repeated
      // here — the labels are generated as "<Endpoint>: <field>", so the half
      // before the colon is the endpoint and there is no second copy to drift.
      label: (rows[0]?.label ?? id).split(':')[0],
      specs: [...rows].sort(
        (a, b) => ENDPOINT_FIELD_ORDER.indexOf(a.key.replace(`ai_${id}_`, ''))
          - ENDPOINT_FIELD_ORDER.indexOf(b.key.replace(`ai_${id}_`, '')),
      ),
    }));
  }, [data]);

  /**
   * The groups, with the thinking dials filled in from the schema.
   *
   * `ai_think_<capability>` is generated per capability in `config/aiKeys.js`,
   * so writing the dials out in GROUPS would put a copy of the registry on
   * this page — the one thing this file's header says it does not keep, and
   * the way a capability ends up with a default nobody can see. Gathering them
   * by prefix means a generating capability added on the server arrives here
   * with its dial already on it.
   *
   * They go BEFORE the group's own keys so the audience toggle stays at the
   * bottom, under the defaults its hint refers to.
   */
  const groups = useMemo(() => {
    const dials = (data?.settings ?? []).filter((s) => /^ai_think_/.test(s.key)).map((s) => s.key);
    return GROUPS.map((g) => (g.id === 'thinking' ? { ...g, keys: [...dials, ...g.keys] } : g));
  }, [data]);

  const set = (key, v) => setEdits((e) => ({ ...e, [key]: v }));

  const save = async () => {
    setSaving(true);
    try {
      // Only what changed. A manager scoped to settings.security must not be
      // 403'd by an unrelated key riding along — the controller rejects the
      // whole PUT if any single key is out of scope.
      //
      // `__base` carries what each of those keys was showing when the page
      // loaded, so a colleague's edit to one of them refuses this save rather
      // than being overwritten. Secrets are deliberately excluded: this page
      // holds '' for every secret whether or not one is stored, so sending that
      // as a baseline would report a conflict on every save of any key that
      // sits beside a configured token. Their own guard is stronger anyway —
      // the controller skips a blank secret entirely, so a secret this page did
      // not retype is never written.
      await api.put('/settings', {
        ...edits,
        __base: Object.fromEntries(Object.keys(edits)
          .filter((k) => !AI_SECRET_KEYS_ON_PAGE.has(k))
          .map((k) => [k, String(byKey[k]?.value ?? '')])),
      });
      toast.success('Saved');
      // Half the keys on this page are `ai_<capability>` switches, and every
      // tool in the admin decides whether to render from the cached copy of
      // `/ai/status`. Without this, switching "Write descriptions" on here and
      // walking to the product editor found no button until the cache aged
      // out — "reload the page and it works" is how a feature earns a
      // reputation for being broken.
      invalidateAiStatus();
      await load();
      // The connection settings live on this page too, so a save can have
      // pointed the shop at an entirely different machine. The list on screen
      // would still be the old box's.
      pollModels();
    } catch (err) {
      // `reportSettingsError` handles the conflict case and falls through to the
      // controller's own `invalid: [{key, error}]`, which is more use than
      // "Request failed".
      reportSettingsError(err, load, setConflicts);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="admin-page"><PageHeader icon={Sparkles} title="AI" /><p>Reading…</p></div>;
  if (!data) return null;

  const enabled = String(valueOf('ai_enabled')) === 'true';

  return (
    <div className="admin-page ai-settings">
      <PageHeader
        icon={Sparkles}
        title="AI"
        subtitle="Everything here is off until you turn it on, and every feature works without it."
      >
        {/* The console's largest settings page by a wide margin — eighty keys —
            and until `help-set-ai` it had no paragraph of its own for the
            assistant to answer from. The question names the page, because that
            is the word retrieval has to match. */}
        <AskAbout
          question="On the AI page in the admin panel, what do the connections, the capability switches and the meaning index control, and what should I know before changing them?"
          title="Ask the assistant what the AI page controls"
        />
      </PageHeader>

      {watch.stale.length > 0 && conflicts.length === 0 && (
        <div className="glass-card admin-panel-in scfl scfl-live" role="status">
          <p className="admin-hint">
            <AlertTriangle size={14} aria-hidden="true" />
            {' '}{watch.by ? `${watch.by} changed` : 'Somebody changed'}
            {' '}{watch.stale.length === 1 ? 'a setting' : `${watch.stale.length} settings`} on this
            page just now: {watch.stale.map((k) => <code key={k} className="scfl-key">{k}</code>)}.
          </p>
          <div className="scfl-foot">
            <button type="button" className="glass-btn glass-btn-primary glass-btn-sm" onClick={() => { watch.clear(); load(); }}>
              Reload
            </button>
            <button type="button" className="glass-btn glass-btn-sm" onClick={watch.clear}>Dismiss</button>
          </div>
        </div>
      )}

      <SettingsConflict
        conflicts={conflicts}
        onTakeTheirs={takeTheirs}
        onKeepMine={keepMine}
        onReload={() => { setConflicts([]); setEdits({}); load(); }}
        onDismiss={() => setConflicts([])}
      />

      {/* What is actually reachable, first — see the header comment. */}
      <div className="ai-health-row">
        <HealthTile label="Model" ok={data.health?.ok} detail={data.health?.ok ? `${data.health.models?.length ?? 0} models` : data.health?.reason} />
        <HealthTile label="Vector store" ok={data.vectorStore?.ok} detail={data.vectorStore?.ok ? `${data.vectorStore.collections?.length ?? 0} collections` : data.vectorStore?.reason} />
        <HealthTile label="Dictation" ok={data.voice?.listen?.ok} detail={data.voice?.listen?.configured ? (data.voice.listen.ok ? 'listening' : data.voice.listen.reason) : 'not configured'} />
        <HealthTile label="Speech" ok={data.voice?.speak?.ok} detail={data.voice?.speak?.configured ? (data.voice.speak.ok ? 'ready' : data.voice.speak.reason) : 'not configured'} />
      </div>

      {/* What the chosen model cannot do.
          A model without `tools` runs the assistant perfectly and simply never
          sets an alert — no error, no log line, and the operator's only clue is
          that a feature they switched on appears not to exist. Said here rather
          than enforced anywhere: there are good reasons to run a model that
          cannot do everything, so this is a sentence, not a refusal. */}
      {probe?.warnings?.length > 0 && (
        <div className="ai-model-warnings" role="status">
          {probe.warnings.map((w) => (
            <p key={w} className="ai-hint ai-hint-warn"><AlertTriangle size={13} aria-hidden="true" /> {w}</p>
          ))}
        </div>
      )}

      {data.index && (
        <p className="ai-index-line">
          Meaning index: {data.index.variants.embedded} of {data.index.variants.total} variants,
          {' '}{data.index.reviews.embedded} of {data.index.reviews.total} reviews.
          {data.spend?.total > 0 && ` ${data.spend.total.toLocaleString()} tokens spent today across ${data.spend.requests} requests.`}
          {/* The cap the operator set, beside the spend it governs. It arrives
              on the same probe as the warnings and had the same problem: a
              daily ceiling an operator can set and never watch is a ceiling
              they discover by the assistant going quiet. Rendered only when
              one is set — an unlimited budget has no progress to report. */}
          {probe?.budget?.cap > 0 && (
            <span className={probe.budget.ok ? undefined : 'is-warn'}>
              {' '}Daily budget: {(probe.budget.spent ?? 0).toLocaleString()} of {probe.budget.cap.toLocaleString()}
              {probe.budget.ok ? '.' : ' — reached, so generation is refused until it resets.'}
            </span>
          )}
          <button type="button" className="glass-btn glass-btn-sm" onClick={load}>
            <RefreshCw size={13} /> Refresh
          </button>
        </p>
      )}

      {/* ── What it costs ─────────────────────────────────────────────────
          Above the switches on purpose. The switch list is what an operator
          CHANGES and the chart is what tells them which switch to change, so
          the reading comes before the controls — the same order the low-stock
          report puts its basis line above its rows. */}
      <UsageChart usage={data.usage} />

      {/* ── What the shop offers ──────────────────────────────────────────── */}
      <section className="glass-card ai-caps">
        <h2><Power size={16} /> What this shop offers</h2>
        <p className="ai-hint">
          Each switch is the shop-wide gate. A buyer still has to agree separately
          to anything that reads their own data, and turning one off here stops it
          at once without erasing what anybody chose.
        </p>
        {['buyer', 'staff'].map((audience) => (
          <div key={audience} className="ai-cap-group">
            <h3>{audience === 'buyer' ? 'For buyers' : 'For staff'}</h3>
            {data.capabilities.filter((c) => c.audience === audience).map((c) => {
              const key = `ai_cap_${c.id}`;
              return (
                <label key={c.id} className={`ai-cap${enabled ? '' : ' ai-cap-inert'}`}>
                  <input
                    type="checkbox"
                    checked={String(valueOf(key)) === 'true'}
                    onChange={(e) => set(key, String(e.target.checked))}
                    disabled={!enabled}
                  />
                  <span>
                    <strong>{c.label}</strong>
                    {c.consent && <em className="ai-cap-consent"><ShieldCheck size={12} /> needs the person&apos;s agreement</em>}
                    <span className="ai-hint">{c.what}</span>
                  </span>
                </label>
              );
            })}
          </div>
        ))}
      </section>

      {/* ── The companion ─────────────────────────────────────────────────
          Its own section, above the generated groups, because it is the one
          setting on this page whose value is a PICTURE. See CompanionCard for
          why the preview is a rehearsal of the statuses rather than a
          thumbnail. */}
      <section className={`glass-card ai-companion${enabled ? '' : ' ai-cap-inert'}`}>
        <h2><PawPrint size={16} /> The companion</h2>
        <p className="ai-hint">
          The animal in the navbar is the AI system&apos;s only visible status
          light: absent means the assistant is off, asleep means the model
          cannot be reached, thinking means it is generating right now. Try the
          statuses below on your own palette — if you cannot tell two of them
          apart, neither will anybody else.
        </p>

        <div className="ai-companion-lay">
          <div className="ai-companion-choose">
            <h3>The store&apos;s companion</h3>
            <CompanionPicker
              value={valueOf('ai_buddy_sprite') || 'none'}
              onChange={(v) => set('ai_buddy_sprite', v)}
              idPrefix="admin-cmp"
            />

            <div className="ai-field">
              <label htmlFor="ai-ai_buddy_name">{byKey.ai_buddy_name?.label}</label>
              <input
                id="ai-ai_buddy_name"
                className="glass-input"
                type="text"
                maxLength={byKey.ai_buddy_name?.max ?? 24}
                value={valueOf('ai_buddy_name')}
                placeholder="the assistant"
                onChange={(e) => set('ai_buddy_name', e.target.value)}
              />
              <p className="ai-hint">{byKey.ai_buddy_name?.hint}</p>
            </div>

            {byKey.ai_buddy_liveliness && (
              <div className="ai-field">
                <label htmlFor="ai-ai_buddy_liveliness">{byKey.ai_buddy_liveliness.label}</label>
                {/* A dial rather than a switch per kind of movement. The
                    option labels carry the difference — "potters near its
                    button" versus "walks the bar" — because that is the whole
                    decision, and a hint under a checkbox called "roam" was
                    where it used to hide. */}
                <select
                  id="ai-ai_buddy_liveliness"
                  className="glass-input"
                  value={valueOf('ai_buddy_liveliness')}
                  onChange={(e) => set('ai_buddy_liveliness', e.target.value)}
                >
                  {byKey.ai_buddy_liveliness.values.map((v) => (
                    <option key={v} value={v}>
                      {byKey.ai_buddy_liveliness.labels?.[v] ?? v}
                    </option>
                  ))}
                </select>
                <p className="ai-hint">{byKey.ai_buddy_liveliness.hint}</p>
              </div>
            )}

            {['ai_buddy_choice'].map((key) => byKey[key] && (
              <label key={key} className="ai-cap">
                <input
                  type="checkbox"
                  checked={String(valueOf(key)) === 'true'}
                  onChange={(e) => set(key, String(e.target.checked))}
                />
                <span>
                  <strong>{byKey[key].label}</strong>
                  <span className="ai-hint">{byKey[key].hint}</span>
                </span>
              </label>
            ))}
          </div>

          {/* The preview reads the EDITED values, not the saved ones, so an
              operator sees what they are about to save rather than what is
              already live. Changing the name and watching the card follow is
              the only confirmation the field gives. */}
          <CompanionCard
            animal={valueOf('ai_buddy_sprite') === 'none' ? null : valueOf('ai_buddy_sprite')}
            name={valueOf('ai_buddy_name').trim() || null}
          >
            <p className="cmp-foot">
              {String(valueOf('ai_buddy_choice')) === 'true'
                ? 'Everybody starts here, and may pick a different animal on their account page. The name stays yours.'
                : 'Everybody sees this one. Turn on the switch beside it to let people choose their own.'}
            </p>
          </CompanionCard>
        </div>
      </section>

      {/* ── One card per connection ───────────────────────────────────────
          Built from whatever endpoints the server declared, not from a list
          here: `config/aiKeys.js` generates five settings per kind of model,
          and every one of them carries the `endpoint` id that groups it. A
          kind of model added there appears here with its own card — including
          its own Tor switch — without this file changing, which is the point
          of generating them rather than writing them out. */}
      {endpointCards.map(({ id, label, specs }) => (
        <section className="glass-card ai-group" key={`endpoint-${id}`}>
          <h2><Server size={16} /> {label}</h2>
          <p className="ai-hint">{ENDPOINT_BLURBS[id] ?? 'Where this kind of model runs, and how this shop reaches it.'}</p>
          <PresetPicker
            presets={data?.presets ?? []}
            slot={data?.endpointSlots?.[id] ?? id}
            endpointId={id}
            provider={valueOf(`ai_${id}_provider`)}
            url={valueOf(`ai_${id}_url`)}
            onPick={(preset) => {
              set(`ai_${id}_provider`, preset.shape);
              set(`ai_${id}_url`, preset.baseUrl);
            }}
          />
          {specs.map((spec) => (
            <Field key={spec.key} spec={spec} value={valueOf(spec.key)} onChange={(v) => set(spec.key, v)} />
          ))}
        </section>
      ))}

      {groups.map((g) => (
        <section key={g.id} className="glass-card">
          <h2><g.icon size={16} /> {g.label}</h2>
          <p className="ai-hint">{g.hint}</p>
          {g.id === 'models' && (
            <p className="ai-models-poll">
              {polling ? 'Reading chat and embedding models…'
                : ['llm', 'embed'].map((id) => `${id === 'llm' ? 'Chat' : 'Embeddings'}: ${catalogue?.[id]?.ok ? `${catalogue[id].models.length} models` : catalogue?.[id]?.reason || 'not loaded'}`).join(' · ')}
              <button type="button" className="glass-btn glass-btn-sm" onClick={pollModels} disabled={polling}>
                <RefreshCw size={13} /> Poll again
              </button>
            </p>
          )}
          {g.keys.map((key) => byKey[key] && (
            MODEL_SLOTS[key]
              ? (
                <ModelField
                  key={key}
                  spec={byKey[key]}
                  slot={MODEL_SLOTS[key]}
                  value={valueOf(key)}
                  onChange={(v) => set(key, v)}
                  catalogue={catalogue?.[key === 'ai_embed_model' ? 'embed' : 'llm']}
                  polling={polling}
                  detached={Object.keys(edits).some((k) => /^ai_(llm|embed)_(provider|url|key|tls_insecure|route)$/.test(k))}
                />
              )
              : <Field key={key} spec={byKey[key]} value={valueOf(key)} onChange={(v) => set(key, v)} />
          ))}
        </section>
      ))}

      <EmbeddingMaintenance onChange={load} />
      <AssistantTestPanel />
      <SmokeRunPanel />

      <SaveBar
        dirtyCount={Object.keys(edits).length}
        saving={saving}
        onSave={save}
        onDiscard={() => setEdits({})}
        cleanNote="Nothing to save."
      />
    </div>
  );
}

/**
 * Known hosts, as buttons that fill in the two fields below.
 *
 * ── Why this is not the setting ─────────────────────────────────────────────
 *
 * The setting is a shape and an address, and that is right: `openai` means the
 * OpenAI-compatible request shape, which a dozen hosts serve and which a shop
 * may be pointing at a vLLM in its own rack. Turning that into a dropdown of
 * company names would take a working configuration away from every operator
 * whose host is not on the list, in order to save the rest a paste.
 *
 * So this fills the fields in and then gets out of the way. Nothing here is
 * stored, nothing validates against it, and the address remains editable
 * afterwards — picking "Groq" and then changing the URL to a proxy in front of
 * Groq is a normal thing to do and nothing about it is a special case.
 *
 * The list is the server's (`config/aiProviders.js`, sent with the schema), so
 * a host added there appears here without this file changing.
 */
function PresetPicker({ presets, slot, endpointId, provider, url, onPick }) {
  const mine = (presets ?? []).filter((p) => p.slots?.includes(slot));
  if (!mine.length) return null;

  // "Which of these is currently configured", by the only thing that can
  // answer it: the two values a preset writes. A shop pointing at its own vLLM
  // matches nothing, and that is not an error state — no button is lit.
  const current = mine.find((p) => p.shape === provider && p.baseUrl === url);
  // An endpoint set to inherit has no address of its own, so offering to fill
  // one in would be offering to detach it — a bigger decision than this
  // control should make silently.
  if (provider === 'same') {
    return (
      <p className="ai-hint ai-presets-inherited">
        Using the language model’s connection. Choose a different API shape below to give
        {endpointId === 'embed' ? ' embeddings' : ' this'} its own.
      </p>
    );
  }

  return (
    <div className="ai-presets">
      <span className="ai-presets-label">Start from</span>
      {mine.map((p) => (
        <button
          type="button"
          key={p.id}
          className={`glass-btn glass-btn-sm${current?.id === p.id ? ' is-active' : ''}`}
          title={`${p.note}${p.key === 'none' ? '' : ' Needs an API key.'}`}
          onClick={() => onPick(p)}
        >
          {p.label}
        </button>
      ))}
      <span className="ai-presets-note">
        Fills in the shape and the address. Anything else speaking one of these APIs works too — type its address in.
      </span>
    </div>
  );
}

function HealthTile({ label, ok, detail }) {
  return (
    <div className={`ai-health${ok ? ' ai-health-ok' : ''}`}>
      <span className="ai-health-label">{label}</span>
      <span className="ai-health-state">{ok ? 'reachable' : 'not reachable'}</span>
      {detail && <span className="ai-health-detail">{detail}</span>}
    </div>
  );
}

/**
 * One model slot, chosen from what the server actually holds.
 *
 * ── Why this is not simply a `<select>` ─────────────────────────────────────
 *
 * Because the shop has to be configurable against a model server that is not
 * answering right now. An operator setting up behind a tunnel that is down, or
 * writing the settings before the GPU box is built, or running an
 * OpenAI-compatible server that lists nothing useful, must still be able to
 * type a name — and a page that offered only a dropdown would leave all three
 * with an empty box and no way forward. So the poll DECORATES the field; it
 * never gates it. No list, or a list that does not contain the current value,
 * degrades to exactly the text input this field used to be.
 *
 * ── Why the wrong-slot models are still listed ──────────────────────────────
 *
 * Ollama reports `embedding` or `completion` per model and the server sorts
 * them into slots from that, so the models that suit this slot lead. The rest
 * stay reachable in a second group rather than being removed: the capability
 * list is metadata baked into a model file by whoever published it, this shop
 * is not the authority on whether it is right, and an operator who knows their
 * model better than its manifest does should not have to edit the database to
 * say so. What they get instead is a label saying what the server believes.
 */
function ModelField({
  spec, slot, value, onChange, catalogue, polling, detached = false,
}) {
  const [custom, setCustom] = useState(false);
  const id = `ai-${spec.key}`;
  const models = detached || !catalogue?.ok ? [] : (catalogue.models ?? []);
  const suited = models.filter((m) => m.slots?.includes(slot));
  const others = models.filter((m) => !m.slots?.includes(slot));
  // A name that is set but not on the server. Never dropped from the box — it
  // is the shop's live configuration, and a field that silently reverted to
  // blank because a tunnel was down would be a field that lost work.
  const missing = value && !models.some((m) => m.name === value);

  if (!models.length || custom) {
    return (
      <div className="ai-field">
        <label htmlFor={id}>{spec.label}</label>
        <input
          id={id}
          className="glass-input"
          type="text"
          maxLength={spec.max}
          value={value}
          placeholder={polling && !detached ? 'reading the server…' : String(spec.default || '')}
          onChange={(e) => onChange(e.target.value)}
        />
        <p className="ai-hint">
          {detached && 'Save connection changes to refresh the model list. '}
          {!detached && catalogue?.reason && `${catalogue.reason} `}
          {spec.hint}
        </p>
        {models.length > 0 && <button type="button" className="glass-btn glass-btn-sm" onClick={() => setCustom(false)}>Choose from server</button>}
      </div>
    );
  }

  return (
    <div className="ai-field">
      <label htmlFor={id}>{spec.label}</label>
      <select
        id={id}
        className="glass-input"
        value={value}
        onChange={(e) => e.target.value === '__custom__' ? setCustom(true) : onChange(e.target.value)}
      >
        {/* Blank is a real answer for the fast slot, which falls back to the
            chat model, and for anything an operator wants to unset. */}
        <option value="">{spec.key === 'ai_fast_model' ? '— use the chat model —' : '— not set —'}</option>
        {missing && <option value={value}>{value} — current, not listed</option>}
        <option value="__custom__">Enter a model ID…</option>
        {suited.length > 0 && (
          <optgroup label={slot === 'embed' ? 'Embedding models' : 'Chat models'}>
            {suited.map((m) => <option key={m.name} value={m.name}>{describeModel(m)}</option>)}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label={slot === 'embed' ? 'Not embedding models' : 'Not chat models'}>
            {others.map((m) => <option key={m.name} value={m.name} disabled>{describeModel(m)}</option>)}
          </optgroup>
        )}
      </select>
      <p className="ai-hint">{spec.hint}</p>
    </div>
  );
}

/**
 * A model as one line an operator can choose from.
 *
 * The size is the number that actually decides things — whether it fits in the
 * card, and how long a first answer will take after a cold start — so it is
 * here rather than in a tooltip. Binary units, because that is what `ollama
 * list` prints and an operator comparing the two screens should see the same
 * figure.
 */
function describeModel(m) {
  const bits = [];
  if (m.parameters) bits.push(m.parameters);
  if (m.size) bits.push(`${(m.size / 1024 ** 3).toFixed(1)} GB`);
  // The vector width, for the embedders this repository knows. It is what the
  // choice actually costs — a 4096-wide model is four times the vector store
  // of a 1024-wide one over the same catalogue — and no model server reports
  // it, so it comes from `config/aiProviders.js` rather than from the wire.
  if (m.dims) bits.push(`${m.dims} wide`);
  // Said out loud, because "why is this model in the wrong list" is otherwise
  // a mystery the operator cannot solve from this page.
  if (!m.capabilities) bits.push('capabilities unknown');
  return bits.length ? `${m.name}  (${bits.join(', ')})` : m.name;
}

/**
 * One setting, drawn from its own spec.
 *
 * The TYPE comes from the registry rather than from a hand-written list here,
 * so a setting added on the server appears on this page with the right control
 * and the right bounds without anyone editing the client.
 */
function Field({ spec, value, onChange }) {
  const id = `ai-${spec.key}`;
  return (
    <div className="ai-field">
      <label htmlFor={id}>{spec.label}</label>
      {spec.type === 'bool' ? (
        <input id={id} type="checkbox" checked={String(value) === 'true'} onChange={(e) => onChange(String(e.target.checked))} />
      ) : spec.type === 'enum' ? (
        <select id={id} className="glass-input" value={value} onChange={(e) => onChange(e.target.value)}>
          {/* The registry may name its options; `labels` is optional and a
              value with none falls back to the value itself, so adding an
              enum setting never requires touching this file. */}
          {spec.values.map((v) => <option key={v} value={v}>{spec.labels?.[v] ?? v}</option>)}
        </select>
      ) : spec.type === 'int' ? (
        <input id={id} className="glass-input" type="number" min={spec.min} max={spec.max} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          id={id}
          className="glass-input"
          type={spec.type === 'secret' ? 'password' : 'text'}
          value={value}
          // A secret is never sent back to the page, so an empty box means
          // "leave it alone" rather than "clear it" — which is what the
          // settings controller already does for every other secret.
          placeholder={spec.type === 'secret' ? (spec.configured ? 'set — leave blank to keep' : 'not set') : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <p className="ai-hint">{spec.hint}</p>
      <NextStops route="/admin/ai" />
    </div>
  );
}
