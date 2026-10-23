/**
 * Tag parsing shared by the catalog filters and the product page.
 *
 * A tag is either flat ("waterproof") or a key/value pair written with one of
 * three separators — "COLOUR: Blue", "COLOUR - Blue", "COLOUR = Blue". The
 * catalog turns the pairs into filter dropdowns; the product page prints the
 * same pairs as a specification table. Both used to be right about the format
 * only by accident, because the parser lived inside pages/Products.jsx and the
 * product page simply rendered every tag as an undifferentiated chip.
 */

/**
 * Parse tags into `{ GROUP: [{ label, value }] }`, where `value` is the
 * original tag (what a filter has to send back) and `label` is the part after
 * the separator (what a human should read). Flat tags collect under the
 * `__flat__` key.
 */
export function groupTags(tags) {
  const groups = {};
  for (const t of tags || []) {
    const colonIdx = t.indexOf(':');
    const dashIdx = t.indexOf(' - ');
    const eqIdx = t.indexOf(' = ');
    let group, value;
    if (eqIdx > 0) {
      group = t.slice(0, eqIdx).trim().toUpperCase();
      value = t.slice(eqIdx + 3).trim();
    } else if (colonIdx > 0) {
      group = t.slice(0, colonIdx).trim().toUpperCase();
      value = t.slice(colonIdx + 1).trim();
    } else if (dashIdx > 0) {
      group = t.slice(0, dashIdx).trim().toUpperCase();
      value = t.slice(dashIdx + 3).trim();
    } else {
      group = '__flat__';
      value = t;
    }
    if (!groups[group]) groups[group] = [];
    groups[group].push({ label: value, value: t });
  }
  return groups;
}

/**
 * Split a tag list into printable specifications and leftover flat tags.
 *
 * Returns `{ specs, flat }` — `specs` is an array of `{ key, values }` in first
 * appearance order, `flat` is the plain tags that carry no key. Duplicate
 * values within one key are collapsed, since a group tag and a variant tag
 * saying the same thing is normal rather than something to print twice.
 */
export function splitSpecs(tags) {
  const groups = groupTags(tags);
  const flat = (groups.__flat__ || []).map(t => t.value);
  const specs = [];
  for (const [key, items] of Object.entries(groups)) {
    if (key === '__flat__') continue;
    // `{ label, value }` pairs, not bare labels.
    //
    // The label is what a human reads ("Indica"); the value is the whole
    // original tag ("Strain Type = Indica"), which is the only thing
    // `/products?tag=` can filter on. Dropping the value here is what kept
    // every specification on the product page unclickable while the flat tags
    // beside them were links — a buyer reading "Indica" had no way to ask for
    // more of it, on the one screen where they are most likely to want to.
    const seen = new Set();
    const values = [];
    for (const i of items) {
      if (seen.has(i.label)) continue;
      seen.add(i.label);
      values.push({ label: i.label, value: i.value });
    }
    specs.push({ key, values });
  }
  return { specs, flat: [...new Set(flat)] };
}
