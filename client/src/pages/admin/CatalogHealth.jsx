import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ClipboardCheck, RefreshCw, FileText, Tags, Image as ImageIcon, MapPin, TrendingDown, Save, ArrowRight, Quote,
} from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { hasAdminPermission } from '../../utils/adminPermissions';
import PageHeader from '../../components/admin/PageHeader';
import AskAbout from '../../components/admin/AskAbout';
import StatTiles from '../../components/admin/StatTiles';
import DraftTool from '../../components/admin/ai/DraftTool';
import NextStops from '../../components/admin/NextStops';

/**
 * Catalogue health: what is listed with something missing, and a queue to fix it.
 *
 * ── The page and the topic read one report ─────────────────────────────────
 *
 * `GET /admin/catalog-health` is `services/catalogHealth.report()`, and so is
 * the assistant's answer to "which products have no description". The count
 * on this tile and the count in that sentence are the same query, which is
 * the only way an operator can check either.
 *
 * ── The draft queue, and what "approve" means here ─────────────────────────
 *
 * Every other `DraftTool` on the admin hands its draft to a form and the
 * form's own Save button commits it. There is no form here — this is a list
 * of products that have no description at all — so the accept button IS the
 * save, and it says so in its label. What does not change is the shape that
 * matters: a person reads the draft, one product at a time, and presses a
 * button whose label names the write. Nothing is generated until pressed and
 * nothing is saved until pressed again. A "draft them all" button was the
 * obvious feature and is deliberately absent: forty descriptions nobody read
 * is forty descriptions nobody approved.
 *
 * ── Who sees the tools ─────────────────────────────────────────────────────
 *
 * The page rides `products.view`; the drafts and the saves need
 * `products.edit`, so the tools render only for somebody who holds it. A
 * viewer without it still gets the lists, which are the report.
 */

const BUCKET_ICON = {
  no_description: FileText,
  no_tags: Tags,
  no_image: ImageIcon,
  no_bin: MapPin,
  no_sales: TrendingDown,
  review_words: Quote,
};

/** Where each bucket's fix actually lives, when it is not on this page. */
const FIX_LINK = {
  media: (item) => ({ to: `/admin/products/${item.id}/edit`, label: 'Add a picture' }),
  shelves: () => ({ to: '/admin/shelves', label: 'File it on a shelf' }),
  products: (item) => ({ to: `/admin/products/${item.id}/edit`, label: 'Open the product' }),
};

export default function CatalogHealth() {
  const { user } = useAuth();
  const canEdit = hasAdminPermission(user, 'products.edit');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/catalog-health');
      setReport(r);
      // Land on the first bucket with something in it, unless the operator
      // has already chosen one.
      setSelected((cur) => cur || Object.values(r.buckets).find((b) => b.count > 0)?.key || 'no_description');
    } catch (err) {
      toast.error(err.message || 'Could not build the report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** A row was fixed: drop it and count it off, without re-querying five buckets. */
  const fixed = (bucketKey, item) => setReport((r) => {
    if (!r) return r;
    const b = r.buckets[bucketKey];
    return {
      ...r,
      buckets: {
        ...r.buckets,
        [bucketKey]: { ...b, count: Math.max(0, b.count - 1), items: b.items.filter((i) => i !== item) },
      },
    };
  });

  if (loading && !report) {
    return <div className="admin-page"><PageHeader icon={ClipboardCheck} title="Catalogue health" /><p>Reading the catalogue…</p></div>;
  }
  if (!report) return null;

  const buckets = Object.values(report.buckets);
  const withIssues = buckets.filter((b) => b.count > 0).length;
  const bucket = report.buckets[selected] || buckets[0];

  return (
    <div className="admin-page">
      <PageHeader
        icon={ClipboardCheck}
        title="Catalogue health"
        subtitle={withIssues
          ? `${report.active_products} active products; ${withIssues} of 5 checks have something to fix.`
          : `${report.active_products} active products, and every check is clear.`}
      >
        <button type="button" className="glass-btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} aria-hidden="true" /> {loading ? 'Reading…' : 'Refresh'}
        </button>
      </PageHeader>

      <StatTiles
        stats={buckets.map((b, i) => ({
          key: b.key,
          label: b.label,
          value: b.count,
          icon: BUCKET_ICON[b.key],
          tone: b.count > 0 ? 'var(--warning)' : 'var(--success)',
          urgent: b.count > 0 && (b.key === 'no_description' || b.key === 'no_image'),
          lead: i === 0,
          active: selected === b.key,
          onClick: () => setSelected(b.key),
          title: b.what,
        }))}
      />

      {/* ── Shelves spelled more than one way ──
          Its own card rather than a sixth bucket: every bucket is a list of
          products with a fix that acts on a product, and this is a list of
          category NAMES. Renaming the smaller spellings onto the largest is the
          merge — the rename endpoint matches exactly, so renaming onto a name
          that exists joins the two — which is why this reports and links rather
          than offering a button that would be a second way to do it. */}
      {report.duplicate_categories?.length > 0 && (
        <section className="glass-card ch-dupes" aria-labelledby="ch-dupes-h">
          <h3 id="ch-dupes-h" className="admin-card-title">
            Categories spelled more than one way
            <AskAbout
              className="ask-about-inline"
              question="Some of my categories differ only by capitals or spacing, so one shelf appears several times in the filters. How do I merge them, and how do I stop it happening again?"
              title="Ask the assistant about duplicate categories"
            />
          </h3>
          <p className="admin-hint">
            These differ only by capitals or spacing, so one shelf shows up several times in the
            storefront filter and the category strip. Rename the smaller ones onto the largest from
            the products grid — renaming onto a name that already exists merges the two. Turning on
            “Tidy category names” in Settings stops new ones appearing.
          </p>
          <ul className="ch-list">
            {report.duplicate_categories.map((d) => (
              <li key={d.key} className="ch-dupe">
                <span className="ch-dupe-names">
                  {d.spellings.map((sp, i) => (
                    <span key={sp.name}>
                      {i > 0 && <span className="ch-dupe-sep"> · </span>}
                      <Link
                        to={`/admin/products?category=${encodeURIComponent(sp.name)}`}
                        className={i === 0 ? 'ch-dupe-main' : undefined}
                      >
                        “{sp.name}”
                      </Link>
                      <span className="ch-dupe-n"> {sp.products}</span>
                    </span>
                  ))}
                </span>
                <span className="ch-dupe-stranded">
                  {d.stranded} product{d.stranded === 1 ? '' : 's'} on the wrong spelling
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {bucket && (
        <section className="glass-card ch-bucket" aria-labelledby={`ch-h-${bucket.key}`}>
          <h3 id={`ch-h-${bucket.key}`} className="admin-card-title">
            {bucket.label}
            {/* The bucket tells you a count; `staff-catalogue-health` is the
                topic that reads the same five SQL buckets and can say what the
                gap costs and which one to clear first. Same query, one step
                closer to the person looking at it. */}
            <AskAbout
              className="ask-about-inline"
              question={`On the catalogue health page, ${bucket.count} ${bucket.count === 1 ? 'item is' : 'items are'} in the "${bucket.label}" bucket. What does that gap actually cost the shop, and is it the one I should clear first?`}
              title={`Ask the assistant about ${bucket.label}`}
            />
          </h3>
          <p className="admin-hint">{bucket.what}</p>

          {bucket.count === 0 ? (
            <p className="ch-empty">Nothing here. Every active product passes this check.</p>
          ) : (
            <>
              <ul className="ch-list">
                {bucket.items.map((item) => (
                  <BucketRow
                    key={item.variant_id ?? item.id}
                    bucket={bucket}
                    item={item}
                    canEdit={canEdit}
                    onFixed={() => fixed(bucket.key, item)}
                  />
                ))}
              </ul>
              {bucket.count > bucket.items.length && (
                <p className="admin-hint">
                  Showing {bucket.items.length} of {bucket.count}. Fix these and refresh for the next batch.
                </p>
              )}
            </>
          )}
        </section>
      )}
      <NextStops route="/admin/catalog-health" />
    </div>
  );
}

function BucketRow({ bucket, item, canEdit, onFixed }) {
  const name = item.variant_name ? `${item.name} — ${item.variant_name}` : item.name;
  const meta = [
    item.brand, item.category,
    item.variant_name && item.quantity != null ? `${item.quantity} in stock` : null,
    item.reviews != null ? `${item.reviews} written review${item.reviews === 1 ? '' : 's'}` : null,
    Array.isArray(item.variant_tags) && item.variant_tags.length ? `tagged ${item.variant_tags.join(', ')}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <li className="ch-row">
      <div className="ch-row-main">
        {/* §9: the product is a record, so its name is the way to it. */}
        <Link className="ch-row-name" to={`/admin/products/${item.id}/edit`}>{name}</Link>
        {meta && <small className="ch-row-meta">{meta}</small>}
      </div>
      {bucket.fix === 'describe' && canEdit && <DescriptionTool item={item} onFixed={onFixed} />}
      {bucket.fix === 'tags' && canEdit && <TagsTool item={item} onFixed={onFixed} />}
      {bucket.fix === 'attributes' && canEdit && <ReviewWordsTool item={item} onFixed={onFixed} />}
      {FIX_LINK[bucket.fix] && (
        <Link className="glass-btn glass-btn-sm" to={FIX_LINK[bucket.fix](item).to}>
          {FIX_LINK[bucket.fix](item).label} <ArrowRight size={12} aria-hidden="true" />
        </Link>
      )}
    </li>
  );
}

/** Draft a description for one product, and save it when — and only when — the operator says so. */
function DescriptionTool({ item, onFixed }) {
  return (
    <DraftTool
      capability="describe"
      icon={FileText}
      label="Draft a description"
      hint="From the name, brand, tags and options. Read it before saving."
      run={() => ({ path: `/ai/describe/${item.id}` })}
      renderDraft={(r) => <p className="aidraft-prose">{r.text}</p>}
      slipTitle="Draft — read it, then save or discard"
      busyLabel="Drafting…"
      acceptNote="…saved to the product, and the row leaves this list."
      actions={[{
        label: 'Save as the description',
        icon: Save,
        primary: true,
        onAccept: async (r) => {
          try {
            await api.put(`/products/${item.id}`, { description: r.text });
            toast.success(`${item.name}: description saved`);
            onFixed();
          } catch (err) {
            toast.error(err.message || 'Could not save the description');
          }
        },
      }]}
    />
  );
}

/**
 * Suggest tags, let the operator pick which, and save the picked ones.
 *
 * Picking is the approval: a suggestion the operator did not press is not
 * saved, however good it looked. The picked set lives in a ref as well as in
 * state because DraftTool hands its accept handler the RESULT, not the
 * page's state, and clears the slip the moment it is pressed.
 */
function TagsTool({ item, onFixed }) {
  const [picked, setPicked] = useState([]);
  const pickedRef = useRef([]);
  pickedRef.current = picked;
  const toggle = (tag) => setPicked((p) => (p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]));

  return (
    <DraftTool
      capability="tags"
      icon={Tags}
      label="Suggest tags"
      hint="Against the tags the shop already uses. Press the ones that fit, then save."
      run={() => { setPicked([]); return { path: `/ai/tags/${item.id}` }; }}
      renderDraft={(r) => {
        const items = Array.isArray(r.items) ? r.items : [];
        if (!items.length) return <p className="aidraft-prose">Nothing usable was proposed for this one.</p>;
        return (
          <div className="aidraft-chips" role="group" aria-label="Suggested tags — press to pick">
            {items.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`aidraft-chip${picked.includes(tag) ? ' is-picked' : ''}`}
                aria-pressed={picked.includes(tag)}
                onClick={() => toggle(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        );
      }}
      slipTitle="Suggestions — pick the ones that fit"
      busyLabel="Thinking…"
      acceptNote="…only the picked tags are saved, and the row leaves this list."
      actions={[{
        label: 'Save the picked tags',
        icon: Save,
        primary: true,
        onAccept: async () => {
          const tags = pickedRef.current;
          if (!tags.length) { toast.error('Pick at least one tag first — nothing was saved.'); return; }
          try {
            await api.put(`/products/${item.id}`, { tags });
            toast.success(`${item.name}: ${tags.length} tag${tags.length === 1 ? '' : 's'} saved`);
            onFixed();
          } catch (err) {
            toast.error(err.message || 'Could not save the tags');
          }
        },
      }]}
    />
  );
}

/**
 * The words reviewers used about one option, offered as variant tags.
 *
 * The attribute extractor (`/ai/attributes/:variantId`, capability `tags`)
 * returns each word with its evidence — how many of the reviews it read use
 * it — and that count is printed on the chip, because a word two reviewers
 * used is a different proposal from one seven did. Picking is the approval;
 * the picked words are ADDED to whatever tags the variant already carries,
 * through the same endpoint the product editor uses, so nothing is dropped.
 * Once one of them lands, the evidence chip on the product page and on the
 * assistant's cards has something to count.
 */
function ReviewWordsTool({ item, onFixed }) {
  const [picked, setPicked] = useState([]);
  const pickedRef = useRef([]);
  pickedRef.current = picked;
  const toggle = (word) => setPicked((p) => (p.includes(word) ? p.filter((w) => w !== word) : [...p, word]));

  return (
    <DraftTool
      capability="tags"
      icon={Quote}
      label="Read the reviews for words"
      hint="What reviewers actually said about this option, each with how many said it."
      run={() => { setPicked([]); return { path: `/ai/attributes/${item.variant_id}` }; }}
      renderDraft={(r) => {
        if (r.enough === false) return <p className="aidraft-prose">Fewer than two usable reviews on this option — nothing to generalise from.</p>;
        const words = Array.isArray(r.attributes) ? r.attributes : [];
        if (!words.length) return <p className="aidraft-prose">The reviews describe nothing the extractor could name.</p>;
        return (
          <div className="aidraft-chips" role="group" aria-label="Words reviewers used — press to pick">
            {words.map((a) => (
              <button
                key={a.word}
                type="button"
                className={`aidraft-chip${picked.includes(a.word) ? ' is-picked' : ''}`}
                aria-pressed={picked.includes(a.word)}
                onClick={() => toggle(a.word)}
                title={`${a.supporting} of ${a.of} reviews use this word`}
              >
                {a.word} <small>{a.supporting}/{a.of}</small>
              </button>
            ))}
          </div>
        );
      }}
      slipTitle="Words with their evidence — pick the ones that fit"
      busyLabel="Reading…"
      acceptNote="…added to this option's tags, and the row leaves this list."
      actions={[{
        label: 'Save the picked words as tags',
        icon: Save,
        primary: true,
        onAccept: async () => {
          const words = pickedRef.current;
          if (!words.length) { toast.error('Pick at least one word first — nothing was saved.'); return; }
          const existing = Array.isArray(item.variant_tags) ? item.variant_tags : [];
          try {
            await api.put(`/products/variants/${item.variant_id}/tags`, { tags: [...existing, ...words] });
            toast.success(`${item.name} — ${item.variant_name}: ${words.length} tag${words.length === 1 ? '' : 's'} added`);
            onFixed();
          } catch (err) {
            toast.error(err.message || 'Could not save the tags');
          }
        },
      }]}
    />
  );
}
