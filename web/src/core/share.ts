/**
 * The share dialog's decisions, away from the dialog: who a typed string names,
 * what an expiry choice means, and what to call a role.
 */

import type { Role, ShareRole } from '@shared/api';

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Editor',
  commenter: 'Commenter',
  viewer: 'Viewer'
};

export const SHARE_ROLE_OPTIONS: { value: ShareRole; label: string }[] = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'commenter', label: 'Commenter' },
  { value: 'editor', label: 'Editor' }
];

// ── who was typed ───────────────────────────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HANDLE = /^[a-z0-9][a-z0-9._-]{0,62}$/;

/**
 * An address or a handle, as the API wants them: exactly one of the two. A
 * leading `@` on a handle is how people write one and is not part of it. The
 * server owns the real grammar and the real lookup ("Nobody has that handle.");
 * this only decides which field the string goes in, and refuses what cannot be
 * either.
 */
export function parseInvitee(raw: string): { handle: string } | { email: string } | null {
  const text = raw.trim();
  if (!text) return null;
  if (EMAIL.test(text)) return { email: text.toLowerCase() };
  const handle = text.replace(/^@/, '').toLowerCase();
  return HANDLE.test(handle) ? { handle } : null;
}

// ── expiry ──────────────────────────────────────────────────────────────────

export type ExpiryPreset = 'never' | '1d' | '7d' | '30d' | 'custom';

export const EXPIRY_OPTIONS: { value: ExpiryPreset; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: '1d', label: 'In 1 day' },
  { value: '7d', label: 'In 7 days' },
  { value: '30d', label: 'In 30 days' },
  { value: 'custom', label: 'On a date' }
];

const DAY = 86_400;
const PRESET_SECONDS: Record<'1d' | '7d' | '30d', number> = { '1d': DAY, '7d': 7 * DAY, '30d': 30 * DAY };

const pad = (n: number): string => String(n).padStart(2, '0');

/** `2026-10-14` in the reader's zone. What `<input type="date">` speaks. */
export function localDateString(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The last second of a local day, as unix seconds. Null for anything that is
 *  not a real date. */
export function endOfLocalDay(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const end = new Date(y, mo - 1, d, 23, 59, 59);
  // `new Date(2026, 1, 31)` rolls over to March; a date that rolled is not real.
  if (end.getFullYear() !== y || end.getMonth() !== mo - 1 || end.getDate() !== d) return null;
  return Math.floor(end.getTime() / 1000);
}

/**
 * The `expiresAt` an option means: null for never, a time for the rest, and
 * undefined when it cannot be decided yet (a date not picked, or one in the
 * past), so the caller can hold the form instead of sending nonsense.
 */
export function expiryFor(
  preset: ExpiryPreset,
  nowSeconds: number,
  customDate = ''
): number | null | undefined {
  if (preset === 'never') return null;
  if (preset === 'custom') {
    const end = endOfLocalDay(customDate);
    return end !== null && end > nowSeconds ? end : undefined;
  }
  return nowSeconds + PRESET_SECONDS[preset];
}

/** "Ends 21 Oct" / "Ended 2 Oct". */
export function expiryNote(expiresAt: number, nowSeconds: number): string {
  const when = new Date(expiresAt * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(new Date(expiresAt * 1000).getFullYear() === new Date(nowSeconds * 1000).getFullYear()
      ? {}
      : { year: 'numeric' })
  });
  return expiresAt > nowSeconds ? `Ends ${when}` : `Ended ${when}`;
}

// ── the link ────────────────────────────────────────────────────────────────

/**
 * The link's URL exists in one response: the one that made it. Only a hash is
 * stored, so a later open of the dialog cannot show it again. It is kept here,
 * in memory, for as long as the page lives, so closing and reopening the dialog
 * does not lose the one copy the owner has.
 */
const urls = new Map<string, string>();
export const rememberLinkUrl = (documentId: string, url: string): void => void urls.set(documentId, url);
export const recallLinkUrl = (documentId: string): string | undefined => urls.get(documentId);
export const forgetLinkUrl = (documentId: string): void => void urls.delete(documentId);
