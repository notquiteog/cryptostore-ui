import { useAuth } from '../../context/AuthContext';
import { canDecryptBlocks } from '../../utils/adminPermissions';
import { splitMessageBlocks } from '../../utils/pgpBlocks';
import EncryptedBlock from './EncryptedBlock';

/**
 * Free text that may contain encrypted blocks — a ticket message, a dispute
 * reply, an order note, a chat line.
 *
 * Text with no block renders exactly as the caller would have rendered it
 * (`as` and `className` are passed straight through), so wrapping a message
 * body in this costs nothing on the ordinary message. Text with a block is
 * split: the prose keeps the same element, and each block becomes an
 * EncryptedBlock, decrypt button included for a viewer who holds the grant.
 * The grant is read from the session (utils/adminPermissions.canDecryptBlocks),
 * so the same rule answers on every surface and a customer looking at their
 * own ticket sees the block, the copy button, and no decrypt.
 *
 * `context` names the surface for the audit row on decrypt.
 */
export default function ArmoredText({ text, as: Tag = 'div', className, context, compact = false }) {
  const { user } = useAuth();
  const value = text == null ? '' : String(text);
  const parts = splitMessageBlocks(value);

  if (parts.length === 1 && parts[0].type === 'text') {
    return <Tag className={className}>{value}</Tag>;
  }

  const canDecrypt = canDecryptBlocks(user);
  return (
    <Tag className={className}>
      {parts.map((part, i) => (
        part.type === 'block'
          ? <EncryptedBlock key={i} armored={part.value} canDecrypt={canDecrypt} context={context} compact={compact} />
          : <span key={i} className="armored-text-prose">{part.value}</span>
      ))}
    </Tag>
  );
}
