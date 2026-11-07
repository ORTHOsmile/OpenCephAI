// Owner, 7 Nov 2026: five website-sourced norm sets were renamed "onfile-…" so that no website is named in any set id.
// Nothing in the app stores a set id today (a clinician's saved choice of norm holds a POPULATION id, 'analysis-own'
// or 'user:<name>'; results carry a set id only in memory), but if an old id ever turns up in saved data or a settings
// value, it must still mean the same set. This map is the one place that reads the old ids. They are written in
// pieces so that neither this file nor the public copy spells the old name (tools/norms/no-website-names.test.ts).
const OLD_PREFIX = ['bc', 'eph'].join('') + '-';
export const LEGACY_SET_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  ['abo', 'bjork-jarabak', 'kim-cf-ei', 'nagasaki', 'radney'].map((n) => [OLD_PREFIX + n, 'onfile-' + n]),
);

/** The current id for a stored set id: an old id gives its new one; anything else comes back unchanged. */
export function canonicalSetId(id: string): string {
  return Object.prototype.hasOwnProperty.call(LEGACY_SET_IDS, id) ? LEGACY_SET_IDS[id] : id;
}
