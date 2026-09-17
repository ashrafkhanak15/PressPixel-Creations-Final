/**
 * Consent bookkeeping for the enquiry form.
 *
 * The stored sentence and the policy version live here so the UI wording, the
 * database value, and the recorded version cannot drift apart unnoticed. The
 * build validator re-derives the version from `lib/legal.json` and fails if
 * this constant no longer matches the privacy policy's "Last Updated" date.
 */

/** The exact sentence stored on each enquiry row. */
export const CONSENT_TEXT = 'Agreed to privacy policy and contact about enquiry';

/**
 * Version token for the privacy policy revision the visitor agreed to,
 * formatted as YYYY-MM. Derived from the policy's "Last Updated" line.
 */
export const CONSENT_VERSION = '2026-05';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** Extracts the YYYY-MM version token from a policy document's Last Updated line. */
export function privacyPolicyVersion(html: string) {
  const match = html.match(/Last Updated:\s*<\/strong>\s*([A-Za-z]+)\s+(\d{4})/);
  if (!match) return 'unknown';
  const monthIndex = MONTHS.indexOf(match[1].toLowerCase());
  if (monthIndex === -1) return 'unknown';
  return `${match[2]}-${String(monthIndex + 1).padStart(2, '0')}`;
}