import { useState } from 'react';
import { MessagesSquare, ClipboardCopy, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DraftTool from './DraftTool';
import { useAuth } from '../../../context/AuthContext';
import { hasAdminPermission } from '../../../utils/adminPermissions';

/**
 * "Turn this into an FAQ entry", on a ticket that has been answered and closed.
 *
 * ── The loop this closes ────────────────────────────────────────────────────
 *
 * `docs/AI.md` describes the FAQ page as the lever for everything the code
 * cannot know: each heading on `page_faq_md` becomes a chunk the assistant
 * retrieves and answers from, so one write teaches the public page AND the
 * assistant. The other half of that loop was missing — the shop learns which
 * questions it actually gets from its support tickets, and nothing carried
 * them back. Somebody answers "can I change my address after ordering" for the
 * ninth time, and the ninth buyer is the tenth person who will ask.
 *
 * This is the carry-back, and it is one button on the one screen where the
 * answer has just been written by somebody who knows it.
 *
 * ── Why it is a copy and not a save ─────────────────────────────────────────
 *
 * The same reason every other tool in this directory proposes rather than
 * applies, and a sharper version of it. The conversation this draft is built
 * from was written by a customer — attacker-supplied text — and its
 * destination is a PUBLIC page carrying the shop's own policies. A write path
 * from here would mean a stranger with a support form and a patient prompt
 * could edit what the store tells everybody else.
 *
 * So the draft goes to the clipboard and the operator goes to the FAQ editor,
 * which has its own permission, its own validation and its own audit trail.
 * The link beside the copy button is the rest of DESIGN §9's answer: naming
 * the next step and not making somebody hunt for it.
 *
 * ── Only on a closed ticket ─────────────────────────────────────────────────
 *
 * Gated here and in `generate.faqEntryStream`, because the reason is the same
 * in both places and neither should be the only one holding it: drafting from
 * an open conversation generalises a holding answer — "let me check that for
 * you" — into a published policy.
 */
export default function FaqAssist({ ticketId, closed }) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  if (!closed) return null;
  if (!hasAdminPermission(user, 'support.reply')) return null;

  /**
   * The entry as it goes on the page: an `h3` heading and a paragraph.
   *
   * `###` rather than `##` because `page_faq_md` already has the page title
   * above it and the editor's own sections use `##` — and because the heading
   * LEVEL is what `services/ai/docChunks.js` splits the corpus on, so getting
   * it wrong produces one enormous chunk instead of one answer per question.
   */
  const asMarkdown = (r) => `### ${r.question}\n\n${r.answer}\n`;

  const copy = async (r) => {
    const text = asMarkdown(r);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Copied — paste it at the end of the FAQ page');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A clipboard write can be refused outright (an insecure origin, a
      // permission policy) and a button that silently does nothing is worse
      // than one that admits it. The text is on screen either way, so the
      // fallback is "select it yourself" rather than a dead end.
      toast.error('Could not reach the clipboard — select the text above and copy it');
    }
  };

  return (
    <DraftTool
      capability="support"
      icon={MessagesSquare}
      label="Draft an FAQ entry"
      hint="Reads this conversation and writes the general question behind it. Nothing is published."
      run={() => ({ path: `/ai/faq-draft/${ticketId}` })}
      slipTitle="Draft FAQ entry — nothing is published"
      acceptNote="…then paste it into the FAQ page and save there."
      renderDraft={(r) => (
        // A model that correctly declines returns nothing, and that is a real
        // answer rather than a failure: a ticket about one buyer's mistyped
        // address generalises to no FAQ entry at all. Saying so is better than
        // an empty slip the operator reads as a broken button.
        r?.question
          ? (
            <div className="faqdraft">
              <h4 className="faqdraft-q">{r.question}</h4>
              <p className="aidraft-prose">{r.answer}</p>
              <p className="faqdraft-note">
                Check it says nothing about one order before you publish it.
              </p>
            </div>
          )
          : (
            <p className="aidraft-prose">
              This one does not generalise — the answer only makes sense for this order.
              Nothing worth publishing.
            </p>
          )
      )}
      actions={[
        {
          label: copied ? 'Copied' : 'Copy the entry',
          icon: ClipboardCopy,
          primary: true,
          onAccept: (r) => { if (r?.question) copy(r); },
        },
      ]}
    >
      {/* The destination, named on the tool's own row. An operator who has just
          drafted an entry wants the page it goes on, and a copy button with no
          stated destination is a clipboard full of markdown and a guess. */}
      <Link to="/admin/pages/faq" className="aidraft-link">
        <ExternalLink size={12} aria-hidden="true" /> FAQ page
      </Link>
    </DraftTool>
  );
}
