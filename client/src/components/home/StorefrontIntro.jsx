import { Link } from 'react-router-dom';
import { useId } from 'react';
import { ArrowUpRight, ArrowRight, Package } from 'lucide-react';
import { productThumb } from '../../utils/catalog';
import { groupDisplayPrice } from '../../utils/pricing';
import { readWelcomeSettings, welcomeDestination } from '../../config/homeWelcome';

function WelcomeLink({ destination, className, children }) {
  if (!destination) return null;
  return destination.to
    ? <Link to={destination.to} className={className}>{children}</Link>
    : <a href={destination.href} className={className}>{children}</a>;
}

/** A shop window built from the published identity and actual featured stock. */
export default function StorefrontIntro({ settings, products = [], loading = false, user = null, preview = false }) {
  const headingId = useId();
  const config = readWelcomeSettings(settings);
  const product = products.find(p => String(p.id) === config.home_welcome_spotlight_product)
    || products.find(p => productThumb(p)) || products[0];
  const image = productThumb(product);
  const price = product?.variants?.length ? groupDisplayPrice(product) : null;
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].slice(0, 5);
  const showSpotlight = config.home_welcome_show_spotlight !== 'false';
  const destinationContext = { settings, user, hasProducts: products.length > 0 };
  const primary = welcomeDestination(config.home_welcome_primary_link, destinationContext);
  const secondary = welcomeDestination(config.home_welcome_secondary_link, destinationContext);
  const Heading = preview ? 'h3' : 'h1';
  if (config.home_welcome_enabled === 'false') return null;

  return (
    <div className="container container-wide">
      <section className={`store-intro${!showSpotlight || (!product && !loading) ? ' store-intro-simple' : ''}`} aria-labelledby={headingId}>
        <div className="store-intro-copy">
          {config.home_welcome_eyebrow && <span className="store-eyebrow"><span className="store-brand-dash" />{config.home_welcome_eyebrow}</span>}
          <Heading id={headingId} className="store-intro-title">{config.home_welcome_heading}{config.home_welcome_highlight && <><br /><span>{config.home_welcome_highlight}</span></>}</Heading>
          {config.home_welcome_description && <p>{config.home_welcome_description}</p>}
          {(primary || secondary) && <div className="store-intro-actions">
            <WelcomeLink destination={primary} className="glass-btn store-primary-action">{config.home_welcome_primary_label} <ArrowRight size={17} aria-hidden="true" /></WelcomeLink>
            <WelcomeLink destination={secondary} className="store-text-action">{config.home_welcome_secondary_label} <ArrowUpRight size={16} aria-hidden="true" /></WelcomeLink>
          </div>}
        </div>
        {showSpotlight && (product ? (
          <Link to={`/products/${product.id}`} className="store-spotlight" aria-label={`Explore ${product.name}`}>
            <div className="store-spotlight-media">
              {image ? <img src={image} alt="" fetchPriority="high" /> : <Package size={72} strokeWidth={0.8} aria-hidden="true" />}
              {config.home_welcome_spotlight_label && <span className="store-spotlight-label">{config.home_welcome_spotlight_label}</span>}
              <span className="store-spotlight-arrow"><ArrowUpRight size={20} aria-hidden="true" /></span>
            </div>
            <div className="store-spotlight-caption">
              <div><span>{product.category || 'Featured selection'}</span><h2>{product.name}</h2></div>
              {price && <strong>{product.variants.length > 1 && <small>From </small>}${price.effective.toFixed(2)}</strong>}
            </div>
          </Link>
        ) : loading ? <div className="store-spotlight store-spotlight-loading" aria-hidden="true" /> : null)}
      </section>
      {config.home_welcome_show_categories !== 'false' && categories.length > 0 && (
        <nav className="store-category-nav" aria-label="Explore categories">
          <span className="store-category-label">Explore</span>
          <Link to="/products" className="store-category-all">All products <ArrowUpRight size={13} aria-hidden="true" /></Link>
          {categories.map(category => <Link key={category} to={`/products?category=${encodeURIComponent(category)}`}>{category}</Link>)}
        </nav>
      )}
    </div>
  );
}
