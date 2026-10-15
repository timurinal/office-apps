/**
 * What a smart chip says, as text.
 *
 * A chip is an inline node with attributes, not text, so anything that reads the text of
 * a document (the word count, find, a plain-text export, the assistant) needs one answer for what
 * it reads as. Kept apart from the chips themselves (chips.ts, which needs Tiptap and the
 * DOM) so a converter can use it without either.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-10-14` as `14 Oct 2026`. Anything that is not a real date is shown as it is. */
export function formatDay(iso: string): string {
  const m = DAY.exec(iso);
  if (!m) return iso;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== mo - 1 || at.getUTCDate() !== d) return iso;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(at);
}

/** Today in the reader's own calendar, plus `days`, as `YYYY-MM-DD`. */
export function isoDay(days = 0, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const isIsoDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && formatDay(v) !== v;

/** The text a chip stands for, or null when `name` is not a chip. */
export function chipText(name: string, attrs: Record<string, unknown>): string | null {
  switch (name) {
    case 'mention':
      return `@${String(attrs.label ?? '')}`;
    case 'dateChip':
      return typeof attrs.date === 'string' ? formatDay(attrs.date) : '';
    case 'docLink':
      return String(attrs.title ?? '');
    default:
      return null;
  }
}
