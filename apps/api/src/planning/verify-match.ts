// Looks for a claimed price, time or text inside the readable text of a page. Matching is
// deliberately strict: a claim that is not found stays unconfirmed instead of being assumed right.

const HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", euro: '€', pound: '£', dollar: '$',
};

// Readable text of an HTML page. JSON-LD blocks are kept: prices and opening hours often live there.
export function pageText(html: string): string {
  const jsonLd = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]!)
    .join(' ');

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .concat(' ', jsonLd)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

const CURRENCY_TOKENS: Record<string, string[]> = {
  EUR: ['€', 'eur', 'euro'],
  USD: ['$', 'usd', 'us$', 'dólar', 'dollar'],
  GBP: ['£', 'gbp'],
  BRL: ['r$', 'brl', 'reais'],
};

// A short excerpt around the match, starting and ending on whole words.
const snippet = (text: string, index: number, length: number) => {
  const start = Math.max(0, index - 30);
  const end = index + length + 30;
  let excerpt = text.slice(start, end);

  if (start > 0) excerpt = excerpt.replace(/^\S*\s/, '');
  if (end < text.length) excerpt = excerpt.replace(/\s\S*$/, '');

  return excerpt.trim();
};

function parseNumber(token: string): number {
  const clean = token.replace(/[\s  ]/g, '');
  const lastDot = clean.lastIndexOf('.');
  const lastComma = clean.lastIndexOf(',');
  const sep = Math.max(lastDot, lastComma);

  if (sep === -1) return Number(clean);

  const decimals = clean.length - sep - 1;
  const bothKinds = lastDot !== -1 && lastComma !== -1;
  // A single separator followed by exactly 3 digits is a thousands separator, otherwise a decimal one.
  if (!bothKinds && decimals === 3) return Number(clean.replace(/[.,]/g, ''));

  return Number(`${clean.slice(0, sep).replace(/[.,]/g, '')}.${clean.slice(sep + 1)}`);
}

// Finds `amount` written next to the currency (symbol or code within 14 characters).
export function findPrice(text: string, amount: number, currency: string): string | null {
  const tokens = CURRENCY_TOKENS[currency.toUpperCase()] ?? [currency.toLowerCase()];
  const numbers = /(?<![\d.,])(?:\d{1,3}(?:[.,  ]\d{3})+(?![\d])(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d])/g;

  for (const match of text.matchAll(numbers)) {
    if (Math.abs(parseNumber(match[0]) - amount) >= 0.005) continue;

    const start = match.index ?? 0;
    const near = text.slice(Math.max(0, start - 14), start + match[0].length + 14).toLowerCase();
    if (tokens.some((token) => near.includes(token))) {
      return snippet(text, start, match[0].length);
    }
  }

  return null;
}

// "9h", "21h", "09:00", "9h30" -> minutes since midnight.
export function extractTimes(text: string): number[] {
  const found = new Set<number>();

  for (const m of text.matchAll(/(?<![\d:.])([01]?\d|2[0-3])\s?(?:h|:)\s?([0-5]\d)?(?![\d])/gi)) {
    found.add(Number(m[1]) * 60 + Number(m[2] ?? 0));
  }

  return [...found].sort((a, b) => a - b);
}

export const formatTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function findTime(text: string, minutes: number): string | null {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? 'am' : 'pm';

  const variants = [`${h}:${mm}`, `${hh}:${mm}`, `${h}h${mm}`, `${hh}h${mm}`, `${h}.${mm}`];
  if (m === 0) variants.push(`${h}h`, `${hh}h`, `${hour12}${suffix}`, `${hour12} ${suffix}`);

  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hit = new RegExp(`(?<![\\d:.])${escaped}(?![\\d])`, 'i').exec(text);
    if (hit) return snippet(text, hit.index, hit[0].length);
  }

  return null;
}

export function findText(text: string, needle: string): string | null {
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  return index === -1 ? null : snippet(text, index, needle.length);
}
