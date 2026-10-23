import { Eye, RotateCcw, Sparkles } from 'lucide-react';
import StorefrontIntro from '../home/StorefrontIntro';
import { WELCOME_TEXT_FIELDS, welcomeFormValues } from '../../config/homeWelcome';
import { STORE_LINK_PICKER } from '../../config/storeLinks';

function TextField({ field, form, set }) {
  const Input = field.multiline ? 'textarea' : 'input';
  return <div className={`form-group${field.multiline ? ' welcome-field-wide' : ''}`}>
    <label htmlFor={field.key}>{field.label} <span className="promise-count">{(form[field.key] || '').length}/{field.max}</span></label>
    <Input id={field.key} className="glass-input" value={form[field.key] || ''} maxLength={field.max}
      rows={field.multiline ? 3 : undefined} onChange={event => set(field.key, event.target.value)}
      placeholder={field.default || ''} aria-describedby={`${field.key}-hint`} />
    <p id={`${field.key}-hint`} className="admin-hint">{field.hint}</p>
  </div>;
}

export default function HomeWelcomeEditor({ form, set, onReset, products, productsLoading, productsError, settings, user }) {
  const enabled = form.home_welcome_enabled !== 'false';
  const selectedProduct = form.home_welcome_spotlight_product || 'auto';
  return <section className="glass-card home-welcome-editor" aria-labelledby="welcome-editor-title">
    <div className="promise-card-head">
      <h2 id="welcome-editor-title" className="promise-card-title"><Sparkles size={16} aria-hidden="true" /> Welcome section</h2>
      <button type="button" className="glass-btn glass-btn-sm" onClick={() => onReset(welcomeFormValues({ store_name: settings.store_name, store_tagline: settings.store_tagline }))}><RotateCcw size={13} aria-hidden="true" /> Reset welcome defaults</button>
    </div>
    <p className="admin-hint">The introduction at the top of your home page. Changes stay in this preview until you save.</p>
    <div className="welcome-visibility">
      {[
        ['home_welcome_enabled', 'Show welcome section'],
        ['home_welcome_show_spotlight', 'Show product spotlight'],
        ['home_welcome_show_categories', 'Show category navigation'],
      ].map(([key, label]) => <label key={key} className="welcome-toggle" htmlFor={key}>
        <input id={key} type="checkbox" checked={form[key] !== 'false'} onChange={event => set(key, event.target.checked ? 'true' : 'false')} />
        <span>{label}</span>
      </label>)}
    </div>
    <div className="welcome-editor-fields">
      {WELCOME_TEXT_FIELDS.slice(0, 4).map(field => <TextField key={field.key} field={field} form={form} set={set} />)}
    </div>
    <h3 className="promise-card-title">Buttons</h3>
    <div className="welcome-editor-fields">
      {['primary', 'secondary'].map((button, index) => <div key={button}>
        <TextField field={WELCOME_TEXT_FIELDS[index + 4]} form={form} set={set} />
        <div className="form-group">
          <label htmlFor={`home_welcome_${button}_link`}>{index === 0 ? 'Primary' : 'Secondary'} button destination</label>
          <select id={`home_welcome_${button}_link`} className="glass-input" value={form[`home_welcome_${button}_link`] ?? ''}
            onChange={event => set(`home_welcome_${button}_link`, event.target.value)}>
            <option value="">Hide this button</option>
            <option value="featured">Featured products on this page</option>
            {STORE_LINK_PICKER.map(link => <option key={link.id} value={link.id}>{link.label}{link.note ? ` — ${link.note}` : ''}</option>)}
          </select>
        </div>
      </div>)}
    </div>
    <p className="admin-hint">Links to unpublished pages stay hidden. Account links appear for signed-in visitors. The featured-products link appears when the shelf has products.</p>
    <h3 className="promise-card-title">Product spotlight</h3>
    <div className="welcome-editor-fields">
      <TextField field={WELCOME_TEXT_FIELDS[6]} form={form} set={set} />
      <div className="form-group">
        <label htmlFor="home_welcome_spotlight_product">Spotlight product</label>
        <select id="home_welcome_spotlight_product" className="glass-input" value={selectedProduct}
          onChange={event => set('home_welcome_spotlight_product', event.target.value)}>
          <option value="auto">Automatic — first featured product with an image</option>
          {selectedProduct !== 'auto' && !products.some(product => String(product.id) === selectedProduct) &&
            <option value={selectedProduct}>Previously selected product — currently unavailable</option>}
          {products.map(product => <option key={product.id} value={String(product.id)}>{product.name}</option>)}
        </select>
        <p className="admin-hint">Uses the product’s current image and price. If your selection leaves the featured shelf, another featured product appears automatically.</p>
      </div>
    </div>
    <div className="welcome-preview-head"><h3 className="promise-card-title"><Eye size={15} aria-hidden="true" /> Welcome preview</h3><span className="badge">Live preview</span></div>
    <p className="admin-hint">Uses your current featured products. Links are inactive here so you can edit without leaving the page.</p>
    {productsError && <p className="admin-hint" role="status">Featured products could not load. You can still edit and save the welcome text.</p>}
    {enabled ? <div className="welcome-preview" onClickCapture={event => { if (event.target.closest('a')) event.preventDefault(); }}>
      <StorefrontIntro settings={{ ...settings, ...form }} products={products} loading={productsLoading} user={user} preview />
    </div> : <p className="welcome-preview-hidden" role="status">The welcome section will be hidden after saving. Your text and product selection are kept.</p>}
  </section>;
}
