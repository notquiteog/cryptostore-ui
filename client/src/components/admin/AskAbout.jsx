import { MessageCircle } from 'lucide-react';
import { askAssistant } from '../../utils/askAssistant';
import { useAiCapability } from '../../hooks/useAiTool';

/**
 * "Ask about this" — one console card's own question, put to the assistant.
 *
 * ── What this generalises, and why it had to be generalised ────────────────
 *
 * The Settings page made this argument first and built the button for itself:
 * an operator reading a card with nine switches on it, wondering which one
 * makes tracking mandatory, had to leave the card, find the animal in the
 * sidebar, and type the card's name into it. So the card asks for them, the
 * question names the thing, and retrieval lands on the manual chunk that
 * answers it.
 *
 * The argument was never about settings. It applies to every lamp on the risk
 * board, every bucket on catalogue health, every order on the bench — and for
 * a while exactly one page had the button, which is the shape `CLAUDE.md`
 * warns about: behaviour that lives in one caller and gets re-typed, slightly
 * differently, by the next one. There is one component now and the pages pass
 * a question.
 *
 * ── The gate belongs here, not in the caller ───────────────────────────────
 *
 * `utils/askAssistant` is deliberately only the wire: "the caller is
 * responsible for not offering the button when the assistant is unavailable".
 * That responsibility is the thing most likely to be forgotten by the seventh
 * page to add one — the symptom being a button that opens nothing on a store
 * with the feature switched off, which reads as a broken console rather than
 * as an absent feature. So the gate is inside the component every caller uses,
 * and a page cannot render the button without it.
 *
 * `offered !== true` rather than `!offered`: `useAiCapability` returns
 * `undefined` until the status request lands, and a button that appears a
 * moment after the page settles is worse than one that appears with it.
 *
 * ── A question, not a topic id ─────────────────────────────────────────────
 *
 * Callers pass the sentence they want asked, phrased as the operator would ask
 * it. The alternative — a key that this component turns into a question — puts
 * the phrasing one indirection away from the page that knows what it means,
 * and the assistant's own matchers are regexes over the words, so the words
 * are the interface. `server/services/ai/topics/` is what decides whether
 * anything can answer it, per the asker's own permissions, on every press.
 */
export default function AskAbout({ question, label = 'Ask', title, className = '' }) {
  const offered = useAiCapability('assistant');
  if (offered !== true || !question) return null;
  const hint = title || 'Ask the assistant about this';
  return (
    <button
      type="button"
      className={`ask-about ${className}`.trim()}
      onClick={() => askAssistant(question)}
      title={hint}
      aria-label={hint}
    >
      <MessageCircle size={13} aria-hidden="true" />
      {label}
    </button>
  );
}
