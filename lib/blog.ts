const DENVER_TIME_ZONE = 'America/Denver';

export { DENVER_TIME_ZONE };

export function slugify(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

export function isSafeCanonicalUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function publicationValidationError(input: {
  status: string;
  title: string;
  slug: string;
  blockCount: number;
  scheduledFor: Date | null;
}) {
  if (input.status !== 'published' && input.status !== 'scheduled') return '';
  if (!input.title.trim() || !input.slug.trim() || input.blockCount < 1) {
    return `${input.status === 'scheduled' ? 'A scheduled' : 'A published'} post needs a title, URL slug, and at least one content block.`;
  }
  if (input.status === 'scheduled' && !input.scheduledFor) {
    return 'A scheduled post needs a valid Denver publish time.';
  }
  return '';
}

export function legacyBlogFallbackEnabled() {
  return (process.env.BLOG_LEGACY_FALLBACK || 'true').trim().toLowerCase() !== 'false';
}

function denverParts(date: Date) {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: DENVER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => Number(values.find((entry) => entry.type === type)?.value || 0);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute') };
}

/** Converts a Denver wall-clock datetime-local value to UTC and rejects DST gaps. */
export function denverDateTimeToUtc(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (!year || !month || !day || hour > 23 || minute > 59) return null;

  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = new Date(target);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = denverParts(candidate);
    const displayedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const correction = target - displayedAsUtc;
    if (correction === 0) break;
    candidate = new Date(candidate.getTime() + correction);
  }

  const result = denverParts(candidate);
  if (result.year !== year || result.month !== month || result.day !== day || result.hour !== hour || result.minute !== minute) return null;
  return candidate;
}

export function utcToDenverDateTime(value: Date | string | null) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = denverParts(date);
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function normalizeTaxonomyName(value: string, maximum = 80) {
  return value.trim().replace(/\s+/g, ' ').slice(0, maximum);
}

export function parseTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = normalizeTaxonomyName(item);
    if (!name) continue;
    unique.set(name.toLocaleLowerCase('en-US'), name);
    if (unique.size >= 12) break;
  }
  return [...unique.values()];
}
