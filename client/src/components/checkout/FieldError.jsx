import { AlertTriangle } from 'lucide-react';
export default function FieldError({ id, message }) {
  if (!message) return null;
  return <p className="field-error" id={id} role="alert"><AlertTriangle size={12} aria-hidden="true" /> {message}</p>;
}
