/**
 * What typed text becomes when it is not a formula: a number, a date or time, a
 * boolean, an error or text, with the number format that shows it back as it was
 * typed (12% stays 12%, not 0.12). Formulas are the engine's, because they bind
 * references to ids: see Engine.contentFromInput.
 */

import { type DateOrder, parseDateTime } from './dates';
import type { CellContent } from './sheet';
import { errorFromLiteral, parseNumber } from './values';

export interface ParsedInput {
  /** null clears the cell. */
  content: CellContent | null;
  format?: string;
}

const decimals = (s: string) => /\.(\d+)/.exec(s)?.[1]?.length ?? 0;
const places = (n: number) => (n ? `.${'0'.repeat(n)}` : '');

/** The format a typed number asks for, or undefined for General. */
function numberFormat(t: string): string | undefined {
  const d = decimals(t);
  if (/%\)?$/.test(t)) return `0${places(d)}%`;
  const cur = /^[-+(]?\s*([$£€¥])/.exec(t)?.[1];
  // $ is a literal in a format code; the others are quoted so no renderer reads them as anything else.
  if (cur) return `${cur === '$' ? '$' : `"${cur}"`}#,##0${places(d)}`;
  if (/\d,\d{3}/.test(t)) return `#,##0${places(d)}`;
  if (/\de/i.test(t)) return '0.00E+00';
  return undefined;
}

export function parseValue(text: string, order: DateOrder = 'dmy'): ParsedInput {
  if (text === '') return { content: null };
  // A leading apostrophe keeps what follows as text, and is not part of it.
  if (text.startsWith("'")) return { content: { v: text.slice(1) } };
  const t = text.trim();
  if (/^true$/i.test(t)) return { content: { v: true } };
  if (/^false$/i.test(t)) return { content: { v: false } };
  const err = errorFromLiteral(t);
  if (err) return { content: { e: err.code } };
  const n = parseNumber(t);
  if (n !== undefined) {
    const format = numberFormat(t);
    return format ? { content: { v: n }, format } : { content: { v: n } };
  }
  const d = parseDateTime(t, order);
  if (d) return { content: { v: d.serial }, format: d.format };
  return { content: { v: text } };
}
