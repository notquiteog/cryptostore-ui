/**
 * The heading block every admin screen opens with.
 *
 * Before this each page hand-rolled its own flex row with inline styles, which
 * is why no two of them agreed on the gap, the icon size, or whether the
 * action button wrapped on a narrow screen.
 *
 * The subtitle is the part worth filling in. A page that says "Orders" tells
 * the operator nothing they did not already know from clicking Orders; one
 * that says "3 awaiting confirmation" tells them where to look next. Pass a
 * live count, not a description of the page.
 *
 * @param {object}   props
 * @param {Function} [props.icon]      lucide icon component
 * @param {string}   props.title
 * @param {import('react').ReactNode} [props.subtitle]
 * @param {import('react').ReactNode} [props.children]  actions, right-aligned
 */
export default function PageHeader({ icon: Icon, title, subtitle, children }) {
  return (
    <header className="admin-page-head">
      <div>
        <h1 className="page-title admin-page-title">
          {Icon && <Icon size={22} aria-hidden="true" />}
          {title}
        </h1>
        {subtitle ? <p className="admin-page-sub">{subtitle}</p> : null}
      </div>
      {children ? <div className="admin-page-actions">{children}</div> : null}
    </header>
  );
}
