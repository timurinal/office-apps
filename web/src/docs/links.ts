/**
 * What a link in a document may point at.
 *
 * Tiptap's own link extension refuses `javascript:` and its kin, and this is
 * the second lock on the same door: the address bar in the toolbar normalises
 * what was typed or pasted, and answers null for anything that is not a web
 * address or a mail address. A link is clickable by every reader of the page, so
 * what gets in has to be safe to follow.
 */

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ALLOWED = new Set(['http:', 'https:', 'mailto:']);

export function normaliseLink(raw: string): string | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;

  let candidate = text;
  if (!SCHEME.test(text)) {
    // "ada@office.test" is an address and "office.test/plan" is a page.
    candidate = text.includes('@') && !text.includes('/') ? `mailto:${text}` : `https://${text}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (!ALLOWED.has(url.protocol)) return null;
  if (url.protocol === 'mailto:') return url.pathname.includes('@') ? candidate : null;
  // "https://foo" is nobody's page, and a typo more often than not.
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  return candidate;
}
