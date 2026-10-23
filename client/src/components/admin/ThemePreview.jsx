import ThemeScenario from './ThemeScenario';
import { useMemo, useState } from 'react';
import { Moon, Sun, Package, ArrowUpRight, Check, ShoppingBag } from 'lucide-react';
import { computeThemeVars, contrastReport } from '../../theme/computeVars';

/** Two real token scopes, not screenshots: the opposite palette remains visible
 * while tuning this one. A compact product record answers the design brief's
 * list question without inventing a second catalogue or fetching customer data.
 * Sample controls stay local to this panel and never touch a real cart. */
function ModePreview({ settings, mode, storeName, onEditMode, flags, scenario, size }) {
  const computed = useMemo(() => computeThemeVars(settings, { mode, ...flags }), [settings, mode, flags]);
  const report = useMemo(() => contrastReport(settings, mode, { ...flags, components: true }), [settings, mode, flags]);
  const failing = report.filter((row) => row.ratio < row.target).length;
  const [added, setAdded] = useState(false);
  const Icon = mode === 'dark' ? Moon : Sun;
  return <section className="thm-specimen" style={{ ...computed.vars, colorScheme: computed.isLight ? 'light' : 'dark' }} data-preview-size={size} aria-label={`${mode} storefront preview`}>
    <header className="thm-specimen-head">
      <span><Icon size={15} /> {mode === 'dark' ? 'Dark' : 'Light'}</span>
      <button type="button" className="glass-btn glass-btn-sm" onClick={() => onEditMode(mode)}>Edit palette <ArrowUpRight size={13} /></button>
    </header>
    <div className="thm-specimen-store"><ShoppingBag size={18} /><strong>{storeName || 'CryptoStore'}</strong><span>Sample</span></div>
    <div className="thm-specimen-product">
      <div className="thm-specimen-art" aria-hidden="true"><Package size={52} strokeWidth={1} /></div>
      <div className="thm-specimen-record">
        <span className="thm-specimen-kicker">Featured product</span>
        <h3>Everyday essentials</h3>
        <p>Carefully packed. Ready to ship.</p>
        <div className="thm-specimen-price"><strong>$48.00</strong><span className="badge badge-success">In stock</span></div>
      </div>
      <div className="thm-specimen-buy">
        <button type="button" className="glass-btn glass-btn-primary" onClick={() => setAdded(!added)} aria-pressed={added}>
          {added ? <Check size={14} /> : <ShoppingBag size={14} />}{added ? 'Added to sample cart' : 'Add to sample cart'}
        </button>
        <button type="button" className="glass-btn" onClick={() => setAdded(false)}>Reset sample</button>
      </div>
    </div>
    <div className="thm-specimen-statuses" aria-label="Stock status samples">
      <span className="badge badge-success">In stock</span>
      <span className="badge badge-warning">Low stock</span>
      <span className="badge badge-danger">Sold out</span>
    </div>
    <label className="thm-specimen-field"><span>Order note</span><input className="glass-input" placeholder="Try typing an order note…" /></label>
    <div className="thm-specimen-ramp"><span>Order received</span><span>Payment confirmation pending</span><span>Updates appear in your order history.</span></div>
    <ThemeScenario scenario={scenario} />
    <footer className="thm-specimen-foot">
      <span className={`badge ${failing ? 'badge-warning' : 'badge-success'}`}>{failing ? `${failing} contrast issue${failing === 1 ? '' : 's'}` : 'Palette passes AA'}</span>
      <span>Palette and component checks on flat backdrops</span>
    </footer>
  </section>;
}

export default function ThemePreview({ settings, storeName, onEditMode }) {
  const [condition, setCondition] = useState('standard');
  const [scenario, setScenario] = useState('payment');
  const [size, setSize] = useState('fluid');
  const flags = useMemo(() => ({
    reduceTransparency: condition === 'solid', increaseContrast: condition === 'contrast',
  }), [condition]);
  return <div className="thm-comparison">
    <div className="thm-comparison-tools">
      <p>Compare both palettes on the same storefront. Sample controls are interactive; no order is placed.</p>
      <label>Workflow<select aria-label="Preview workflow" className="glass-input" value={scenario} onChange={e => setScenario(e.target.value)}>
        <option value="payment">Partial payment</option><option value="checkout">Address error</option><option value="stock">Unavailable variant</option><option value="packing">Packing shortage</option><option value="orders">Order queue</option>
      </select></label>
      <label>Width<select className="glass-input" value={size} onChange={e => setSize(e.target.value)}><option value="fluid">Available width</option><option value="phone">Phone · 320 px</option><option value="tablet">Tablet · 768 px</option></select></label>
      <label>Preview conditions
        <select className="glass-input" value={condition} onChange={(e) => setCondition(e.target.value)}>
          <option value="standard">Standard appearance</option>
          <option value="solid">Reduced transparency</option>
          <option value="contrast">Increased contrast</option>
        </select>
      </label>
    </div>
    <div className="thm-comparison-grid">
      {['dark', 'light'].map((mode) => <ModePreview key={mode} settings={settings} mode={mode} storeName={storeName} onEditMode={onEditMode} flags={flags} scenario={scenario} size={size} />)}
    </div>
  </div>;
}
