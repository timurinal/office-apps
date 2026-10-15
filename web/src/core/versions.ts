/**
 * The history list: grouping versions by day, and naming each one.
 *
 * Days are the reader's own (local time), because "today" and "yesterday" mean
 * the reader's calendar. Everything here is pure so the panel is just drawing.
 */

import type { VersionAuthor, VersionKind, VersionSummary } from '@shared/api';

export interface VersionDay {
  /** `2026-10-14`, local. Stable, for React keys. */
  key: string;
  label: string;
  versions: VersionSummary[];
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The local calendar day a unix time falls on. */
export function dayKey(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Today", "Yesterday", "3 Oct", or "20 Dec 2025" from another year. */
export function dayLabel(unixSeconds: number, nowSeconds: number): string {
  const key = dayKey(unixSeconds);
  if (key === dayKey(nowSeconds)) return 'Today';
  if (key === dayKey(nowSeconds - 86_400)) return 'Yesterday';
  const d = new Date(unixSeconds * 1000);
  const sameYear = d.getFullYear() === new Date(nowSeconds * 1000).getFullYear();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' })
  });
}

/** "10:42", 24 hour. */
export const timeOfDay = (unixSeconds: number): string => {
  const d = new Date(unixSeconds * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "today at 10:42", "yesterday at 10:42", "3 Oct at 10:42": for inside a sentence. */
export function whenPhrase(unixSeconds: number, nowSeconds: number): string {
  const day = dayLabel(unixSeconds, nowSeconds);
  const lead = day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day;
  return `${lead} at ${timeOfDay(unixSeconds)}`;
}

/** Newest first, split by local day. DST makes a day 23 or 25 hours, so days
 *  are compared by calendar date and not by subtracting 86,400. */
export function groupByDay(versions: readonly VersionSummary[], nowSeconds: number): VersionDay[] {
  const sorted = [...versions].sort(
    (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
  const days: VersionDay[] = [];
  for (const v of sorted) {
    const key = dayKey(v.createdAt);
    const last = days[days.length - 1];
    if (last && last.key === key) last.versions.push(v);
    else days.push({ key, label: dayLabel(v.createdAt, nowSeconds), versions: [v] });
  }
  return days;
}

/** What to call a version that has no name of its own. */
const KIND_TITLE: Record<VersionKind, string> = {
  auto: 'Edited',
  named: 'Named version',
  restore: 'Before restore',
  assist: 'Automatic edit',
  import: 'Imported',
  locked: 'Saved'
};

export function versionTitle(v: Pick<VersionSummary, 'kind' | 'label'>): string {
  return v.label?.trim() || KIND_TITLE[v.kind];
}

/** Only a named version has a name to change. */
export const canRename = (v: Pick<VersionSummary, 'kind'>): boolean => v.kind === 'named';

/** "Ada Rowe", "Ada Rowe and Ben Okoro", "Ada Rowe and 2 others". */
export function authorsLine(authors: readonly VersionAuthor[]): string {
  const names = [...new Set(authors.map((a) => a.name))];
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} others`;
}
