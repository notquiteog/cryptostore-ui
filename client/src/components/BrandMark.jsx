import { useTheme } from '../context/ThemeContext';

/**
 * The store's mark, for pages that should open with the brand rather than a
 * generic heading — the auth screens replaced "Sign In / Welcome back" with
 * this, because a buyer typing credentials should see WHO is asking, not a
 * caption that would read the same on any store on the internet.
 *
 * Follows the same rules as the navbar and the age gate, on purpose:
 * `navbar_logo_dynamic_color` recolours the LOGO, not one bar it happens to
 * sit in, so it is honoured here too; a store with no logo uploaded gets its
 * name as a wordmark — never a placeholder badge that says nothing about who
 * is asking.
 */
export default function BrandMark({ className = '' }) {
  const { settings } = useTheme();
  const storeName = settings.store_name || 'CryptoStore';
  const rounded = settings.favicon_rounded === 'true';

  return (
    <div className={`brand-mark ${className}`.trim()}>
      {settings.store_logo ? (
        settings.navbar_logo_dynamic_color === 'true' ? (
          <div
            role="img"
            aria-label={storeName}
            className={`brand-mark-dynamic${rounded ? ' brand-mark-round' : ''}`}
            style={{ '--logo-src': `url("${settings.store_logo}")` }}
          />
        ) : (
          <img
            className={`brand-mark-img${rounded ? ' brand-mark-round' : ''}`}
            src={settings.store_logo}
            alt={storeName}
          />
        )
      ) : (
        <div className="brand-mark-wordmark">{storeName}</div>
      )}
    </div>
  );
}
