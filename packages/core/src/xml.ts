/**
 * The one XML parser configuration, and the one way to read a repeated child.
 *
 * fast-xml-parser needs the same six options every time it reads the
 * Commission's feed, and one of them is load-bearing:
 *
 * `htmlEntities` decodes numeric character references, which the live feed uses
 * for apostrophes (`O&#39;CONNOR, Simon`) where the 2017 and 2020 archives use
 * the named form (`O&apos;CONNOR`). Without it the reference survives parsing
 * and the name reaches the dashboard — table, map label and chart legend —
 * rendered literally as `O&#39;CONNOR`. Three copies of this object were three
 * chances to miss that, so the collector and both core parsers share one.
 *
 * Values are kept as strings: the numeric IDs (`p_no`, `c_no`, `e_no`,
 * `vp_id`, `list_no`) key the lookup maps, and coercing them to numbers makes
 * a string-keyed lookup miss. Votes are converted explicitly where they are
 * read.
 */

import { XMLParser } from 'fast-xml-parser';

export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  htmlEntities: true,
});

/**
 * fast-xml-parser returns a single object instead of an array when an element
 * appears once, so every loop over `<candidate>`, `<party>`, `<electorate>` or
 * `<votingplace>` has to normalise first.
 */
export function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return value ? [value as T] : [];
}
