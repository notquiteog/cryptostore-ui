/**
 * The one place a staff AI tool is run, and the one place its failures are
 * turned into a sentence.
 *
 * ── Why every tool goes through here ───────────────────────────────────────
 *
 * There are seven staff endpoints (`server/routes/ai.js`) and they fail in the
 * same five ways: the operator has the capability off, the shop has spent its
 * daily token budget, the model host is unreachable, the text was too long, or
 * the person lacks the permission. Written per call site, that is five
 * `if (err.status === …)` ladders per tool and forty-odd chances to render a
 * 502 as "something went wrong" — which tells an operator nothing, and in
 * particular does not tell them the one thing they can act on, which is
 * usually "your model host is down" or "you switched this off".
 *
 * So the tools do not talk to `api` directly. They name a path and a body, and
 * get back a state machine whose error is already a sentence an operator can
 * act on. Adding an eighth tool that invents its own error handling is
 * possible but awkward, which is the point.
 *
 * ── Why it streams, and why thinking has its own field ─────────────────────
 *
 * These endpoints answered with one JSON object when the model had finished.
 * On a small local model that is fifteen to thirty seconds of motionless
 * spinner; with `ai_allow_thinking` on it is well over a minute, because a
 * reasoning model spends the opening stretch entirely in its thinking channel
 * and emits no answer text at all. An operator cannot tell that from a hung
 * tunnel.
 *
 * They now stream NDJSON, and this hook keeps the two channels APART:
 * `thinking` and `text` are separate strings all the way to the renderer. That
 * separation is not presentational. A model's working-out contains false
 * starts and restates its context more bluntly than the answer does, and a
 * tool that concatenated them would offer an operator a "use this" button over
 * text that includes the model arguing with itself.
 *
 * ── Why the result is held rather than applied ─────────────────────────────
 *
 * None of these endpoints saves anything, and `server/routes/ai.js` says why
 * in as many words: the operator saves through the ordinary admin routes, so
 * a successful prompt injection cannot change the catalogue. That property is
 * only real if the CLIENT honours it too — a tool that wrote its answer
 * straight into the form and auto-saved would hand the model the write the
 * server carefully withheld.
 *
 * So `run()` produces a draft into `result` and stops. Something a person
 * presses moves it into the field, and their own save commits it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAiStatus, capabilityOffered } from '../utils/aiStatus';
import { readNdjson } from '../utils/aiStream';

const BASE = '/api';

/**
 * Turn a failure into something worth reading.
 *
 * Failures arrive two ways now and mean the same things in both. A request
 * rejected before streaming starts is a status code with a JSON body; one that
 * fails after the first token cannot be a status code any more — the headers
 * have gone — so it is an `{type:'error', code}` event. The `code` strings are
 * identical either way, which is what lets this be one function.
 */
function explain({ code, message, status }) {
  if (code === 'ai_disabled' || code === 'ai_capability_off') {
    return { message: message || 'This shop does not offer that.', retryable: false, off: true };
  }
  // Not retryable and not `off`: the tool stays on the page because a
  // DIFFERENT ticket may have a customer who has agreed. Offering "try again"
  // here was the bug — the refusal is about a person, not a moment, so it will
  // refuse identically however many times it is pressed.
  if (code === 'ai_consent_required') {
    return { message: message || 'The person this concerns has not agreed to it.', retryable: false };
  }
  if (code === 'ai_budget_spent') {
    return { message: message || 'The daily AI budget for this shop is spent.', retryable: false };
  }
  // Retryable, and worth retrying: a model that spent its whole answer
  // deliberating often does write one on a second attempt. The server's
  // message names the setting to change if it keeps happening.
  if (code === 'ai_empty_answer') {
    return { message: message || 'The model did not write an answer.', retryable: true };
  }
  if (status === 403) {
    return { message: 'You do not hold the permission for this tool.', retryable: false, off: true };
  }
  if (status === 413) {
    return { message: message || 'That is too long to send in one go.', retryable: false };
  }
  if (status === 400) {
    return { message: message || 'There is nothing here to work from.', retryable: false };
  }
  if (status === 429) {
    return { message: message || 'Too many requests. Wait a moment and try again.', retryable: true };
  }
  // `ai_unavailable` and everything unclassified. Retryable because the common
  // cause is a model host that has gone away for a moment, and the useful
  // thing to offer is the button again rather than an explanation.
  return {
    message: message || 'The model did not answer. It may be down or still loading.',
    retryable: true,
  };
}

/**
 * Is this capability offered? Renders nothing until the answer is known.
 *
 * The `undefined` third state matters: a tool that treated "not yet loaded" as
 * "not offered" would flash its button in a moment after the page settles,
 * which reads as the interface changing its mind. Callers render nothing while
 * `offered` is undefined.
 */
export function useAiCapability(capability) {
  const [offered, setOffered] = useState(undefined);

  useEffect(() => {
    let alive = true;
    getAiStatus().then((status) => {
      if (alive) setOffered(capabilityOffered(status, capability));
    });
    return () => { alive = false; };
  }, [capability]);

  return offered;
}

/**
 * One staff tool: whether to show it, how to run it, what is arriving.
 *
 * `request` is called with whatever `run()` was given and returns
 * `{ path, body }` — a function rather than a fixed value because every caller
 * closes over a field the operator is still typing into.
 */
export function useAiTool(capability, request) {
  const offered = useAiCapability(capability);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  /** The answer as it arrives, before the server's parsed `result` lands. */
  const [streamed, setStreamed] = useState('');
  /** The model's working-out. Never merged into the above; see the header. */
  const [thinking, setThinking] = useState('');

  /**
   * How hard to think, for the next run only — and note this is NOT the state
   * above. `thinking` is the working-out that comes BACK; `thinkLevel` is how
   * much of it to ask for. Two nouns one letter apart is how a bug gets
   * written, so they are named for what they are.
   *
   * `''` means "no opinion", and the shop uses the operator's default for this
   * capability — different from `'off'`, which overrides it downwards. Not
   * persisted: a level chosen for one hard draft should not quietly make every
   * later one slow.
   *
   * `canThink` comes from the server for THIS viewer (`ai_thinking_toggle`),
   * never worked out on the client — see server/controllers/aiController.js.
   */
  const [thinkLevel, setThinkLevel] = useState('');
  const [thinkOptions, setThinkOptions] = useState(null);
  const thinkLevelRef = useRef('');
  thinkLevelRef.current = thinkLevel;

  // The capability can be switched off underneath a rendered button — the
  // server is the gate, and it says so with `off`. Latching that here removes
  // the button rather than leaving it to be pressed again for the same answer.
  const [offLocally, setOffLocally] = useState(false);

  useEffect(() => {
    let alive = true;
    getAiStatus().then((status) => {
      if (!alive) return;
      setThinkOptions(status?.thinking_toggle
        ? (status.thinking_levels || ['off', 'low', 'medium', 'high'])
        : null);
    });
    return () => { alive = false; };
  }, []);

  const requestRef = useRef(request);
  requestRef.current = request;

  // A tool whose page unmounts mid-generation must not set state afterwards,
  // and a second press must not let a slow first answer overwrite a fast
  // second one. One token does both.
  const tokenRef = useRef(0);
  const abortRef = useRef(null);

  useEffect(() => () => {
    tokenRef.current += 1;
    // Abandoning a generation without aborting leaves the model server holding
    // the slot for the full two-minute timeout. The route listens for the
    // close and stops the generator.
    abortRef.current?.abort();
  }, []);

  const run = useCallback(async (...args) => {
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    const live = () => tokenRef.current === token;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setBusy(true);
    setError(null);
    setStreamed('');
    setThinking('');

    try {
      const { path, body, method = 'POST' } = requestRef.current(...args);
      // Injected here rather than in nine callers, so a tool cannot ship
      // without it and none of them has to remember. Dropped server-side for a
      // caller the operator has not let near it, so sending it is harmless.
      //
      // Read through a ref, not from the closure: `run` is memoised with an
      // empty dependency list — deliberately, so a tool's `onClick` identity
      // does not change on every keystroke in the field it closes over — and a
      // value captured in that closure would be whatever the level was when
      // the component first mounted, for the life of the page.
      const level = thinkLevelRef.current;
      const sent = level && body ? { ...body, thinking: level } : body;
      const token_ = localStorage.getItem('token');
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token_ ? { Authorization: `Bearer ${token_}` } : {}),
        },
        ...(sent ? { body: JSON.stringify(sent) } : {}),
        signal: abort.signal,
      });

      // Rejected before the stream began: still a status code and a JSON body.
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        if (!live()) return null;
        const explained = explain({ code: payload.code, message: payload.error, status: res.status });
        setError(explained);
        if (explained.off) setOffLocally(true);
        return null;
      }

      let final = null;
      for await (const event of readNdjson(res)) {
        if (!live()) return null;
        if (event.type === 'thinking') {
          setThinking((t) => t + event.text);
        } else if (event.type === 'content') {
          setStreamed((t) => t + event.text);
        } else if (event.type === 'error') {
          const explained = explain({ code: event.code, message: event.message });
          setError(explained);
          if (explained.off) setOffLocally(true);
          return null;
        } else if (event.type === 'result') {
          // The server's PARSED answer, which is not the same as the tokens
          // that arrived: `parseProse` strips code fences and stray quoting,
          // and the structured tools return a list the stream never carried at
          // all. The streamed text is what the operator watched appear; this
          // is what they get to keep.
          final = event;
        }
      }

      if (!live()) return null;
      if (final == null) {
        // The stream ended without a result. A truncated generation, or a
        // proxy that cut the response — either way there is nothing to accept,
        // and saying so beats an empty slip.
        setError(explain({ message: 'The answer stopped part way through. Try again.' }));
        return null;
      }
      setResult(final);
      return final;
    } catch (err) {
      if (!live() || err?.name === 'AbortError') return null;
      setError(explain({ message: err?.message }));
      return null;
    } finally {
      if (live()) setBusy(false);
    }
  }, []);

  const clear = useCallback(() => {
    // Bump the token and abort so a generation still in flight cannot land in
    // a panel the operator has just dismissed — and does not keep the model
    // busy for an answer nobody will read.
    tokenRef.current += 1;
    abortRef.current?.abort();
    setResult(null);
    setError(null);
    setStreamed('');
    setThinking('');
    setBusy(false);
  }, []);

  return {
    offered: offered === undefined ? undefined : offered && !offLocally,
    busy,
    error,
    result,
    streamed,
    thinking,
    run,
    clear,
    // The per-request dial. `thinkOptions` is null when this viewer does not
    // get one, which is the signal to render nothing at all.
    thinkLevel,
    setThinkLevel,
    thinkOptions,
  };
}
