import { useEffect, useState } from 'react';

/**
 * A quantity you can TYPE, not just step.
 *
 * Steppers are right for ±1 fixups and hopeless for "54": a packer moving
 * fifty-four units into a box must not press a button fifty-four times. This
 * renders the number itself as a small numeric input — tap, type, Enter or
 * blur commits, Escape reverts — and commits the ABSOLUTE value, matching the
 * idempotent write shape every bench endpoint uses.
 *
 * The draft is local so typing "5" on the way to "54" never fires a request;
 * out-of-range entries clamp to [0, max] on commit (the server enforces the
 * same bound — clamping here just saves the round trip and the toast). The
 * parent's keyboard shortcuts already ignore keys while an INPUT has focus,
 * so typing digits here cannot trigger the bench's exact-set hotkeys.
 */
export default function QtyInput({ value, max, disabled, onCommit, ariaLabel, className }) {
  const [draft, setDraft] = useState(String(value));

  // The server's echo is the truth; a stale draft must not survive it.
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const n = parseInt(draft, 10);
    if (!Number.isInteger(n)) { setDraft(String(value)); return; }
    const clamped = Math.max(0, Math.min(max, n));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <input
      className={`qty-input${className ? ` ${className}` : ''}`}
      type="number"
      inputMode="numeric"
      min="0"
      max={max}
      step="1"
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        if (e.key === 'Escape') { setDraft(String(value)); e.target.blur(); }
      }}
    />
  );
}
