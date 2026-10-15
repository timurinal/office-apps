/**
 * Number formats as the ribbon offers them: the categories in the dropdown, a currency's code, and
 * the arithmetic behind "more decimals" and "fewer decimals".
 *
 * A cell stores an Excel format code (`#,##0.00`, `"£"#,##0.00`, `dd/mm/yyyy`) and the engine's
 * `formatValue` draws it, so everything here is about choosing and changing a code. Nothing here
 * knows a cell, a model or a context.
 *
 * A currency's symbol is quoted in the code except the dollar, which the engine (like Excel) reads
 * as a literal without quotes. Excel's accounting layout pads with a fill character the grid does
 * not draw, so Accounting here is the same code with the trailing space and the brackets and no fill.
 */

import { isDateFormat } from '../engine';

export interface Currency {
  symbol: string;
  name: string;
}

export const CURRENCIES: readonly Currency[] = [
  { symbol: '£', name: 'Pound' },
  { symbol: '$', name: 'Dollar' },
  { symbol: '€', name: 'Euro' },
  { symbol: '¥', name: 'Yen' }
];

export const DEFAULT_CURRENCY = '£';

const places = (n: number): string => (n > 0 ? `.${'0'.repeat(n)}` : '');
const quoted = (symbol: string): string => (symbol === '$' ? '$' : `"${symbol}"`);

/** `"£"#,##0.00`. */
export function currencyCode(symbol: string, decimals = 2): string {
  return `${quoted(symbol)}#,##0${places(decimals)}`;
}

/** `"£"#,##0.00_);("£"#,##0.00)`: a negative in brackets, a positive lined up with it. */
export function accountingCode(symbol: string, decimals = 2): string {
  const n = `#,##0${places(decimals)}`;
  return `${quoted(symbol)}${n}_);(${quoted(symbol)}${n})`;
}

export type FormatId =
  | 'general'
  | 'number'
  | 'currency'
  | 'accounting'
  | 'date-short'
  | 'date-long'
  | 'time'
  | 'percent'
  | 'fraction'
  | 'scientific'
  | 'text'
  | 'custom';

export interface FormatChoice {
  id: FormatId;
  label: string;
  /** The code the category applies; currency's follows the currency in use. */
  code: (currency: string) => string;
}

export const FORMATS: readonly FormatChoice[] = [
  { id: 'general', label: 'General', code: () => 'General' },
  { id: 'number', label: 'Number', code: () => '0.00' },
  { id: 'currency', label: 'Currency', code: (c) => currencyCode(c) },
  { id: 'accounting', label: 'Accounting', code: (c) => accountingCode(c) },
  { id: 'date-short', label: 'Short date', code: () => 'dd/mm/yyyy' },
  { id: 'date-long', label: 'Long date', code: () => 'dddd, d mmmm yyyy' },
  { id: 'time', label: 'Time', code: () => 'hh:mm:ss' },
  { id: 'percent', label: 'Percentage', code: () => '0.00%' },
  { id: 'fraction', label: 'Fraction', code: () => '# ?/?' },
  { id: 'scientific', label: 'Scientific', code: () => '0.00E+00' },
  { id: 'text', label: 'Text', code: () => '@' }
];

export const formatChoice = (id: string): FormatChoice | undefined => FORMATS.find((f) => f.id === id);

/** What a code is with its quoted text, its colours and its brackets taken out: only the symbols that make it what it is. */
function bare(code: string): string {
  return code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
}

/** Which category in the dropdown a code belongs to; `custom` for one that is none of them. */
export function categoryOf(code: string | undefined): FormatId {
  if (!code || /^general$/i.test(code.trim())) return 'general';
  const first = code.split(';')[0] ?? code;
  const b = bare(first);
  if (b.trim() === '@') return 'text';
  if (/%/.test(b)) return 'percent';
  if (/E[+-]/i.test(b)) return 'scientific';
  if (/\?\/[?\d]/.test(b)) return 'fraction';
  if (isDateFormat(code)) {
    // A time has hours or seconds and no day, month or year; an `m` beside either is a minute.
    const t = b.replace(/AM\/PM|A\/P/gi, '').replace(/h+:?m+|m+:?s+|:m+/gi, '');
    if (/[hs]/i.test(b) && !/[dym]/i.test(t)) return 'time';
    return /d{4}|m{4}/i.test(b) ? 'date-long' : 'date-short';
  }
  // A symbol on its own, quoted or not, or a locale bracket `[$€-x-euro2]`; a quoted word is not one.
  if (/[$£€¥]/.test(b) || /"[£$€¥]"/.test(first) || /\[\$/.test(first)) {
    return /_\)|\(/.test(code) && /\)/.test(code) ? 'accounting' : 'currency';
  }
  if (/[0#?]/.test(b)) return 'number';
  return 'custom';
}

/** The currency symbol a code shows, if it shows one. */
export function currencyOf(code: string | undefined): string | null {
  if (!code) return null;
  for (const c of CURRENCIES) if (code.includes(`"${c.symbol}"`) || (c.symbol === '$' && /\$/.test(code))) return c.symbol;
  return null;
}

/** Whether a code puts a thousands separator in its number. */
export const hasThousands = (code: string | undefined): boolean => !!code && /#,##0|0,000/.test(bare(code.split(';')[0] ?? code));

// ── decimals ────────────────────────────────────────────────────────────────

/** Splits a code at its unquoted semicolons. */
function sections(code: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === '"') {
      const end = code.indexOf('"', i + 1);
      const stop = end < 0 ? code.length : end + 1;
      cur += code.slice(i, stop);
      i = stop - 1;
    } else if (ch === '\\' || ch === '_' || ch === '*') {
      cur += code.slice(i, i + 2);
      i++;
    } else if (ch === '[') {
      const end = code.indexOf(']', i);
      const stop = end < 0 ? code.length : end + 1;
      cur += code.slice(i, stop);
      i = stop - 1;
    } else if (ch === ';') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Where a section's number is: the first run of digit placeholders, `.` and `,` outside quotes and brackets. */
function numberSpan(section: string): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  for (let i = 0; i < section.length; i++) {
    const ch = section[i]!;
    if (ch === '"') {
      const end = section.indexOf('"', i + 1);
      if (from >= 0) break;
      i = end < 0 ? section.length : end;
      continue;
    }
    if (ch === '[') {
      const end = section.indexOf(']', i);
      if (from >= 0) break;
      i = end < 0 ? section.length : end;
      continue;
    }
    if (ch === '\\' || ch === '_' || ch === '*') {
      if (from >= 0) break;
      i++;
      continue;
    }
    if ('0#?'.includes(ch) || (from >= 0 && '.,'.includes(ch))) {
      if (from < 0) from = i;
      to = i + 1;
    } else if (from >= 0) break;
  }
  return from < 0 ? null : { from, to };
}

/** One section with a decimal place more or fewer; the section as it was when it has no number or nothing to remove. */
function stepSection(section: string, delta: 1 | -1): string {
  const span = numberSpan(section);
  if (!span) return section;
  const num = section.slice(span.from, span.to);
  // Trailing commas scale by a thousand each and stay at the end.
  const tail = /,+$/.exec(num)?.[0] ?? '';
  const core = num.slice(0, num.length - tail.length);
  const dot = core.indexOf('.');
  let next: string;
  if (delta === 1) next = dot < 0 ? `${core}.0` : `${core}0`;
  else if (dot < 0) return section;
  else next = core.length - dot - 1 <= 1 ? core.slice(0, dot) : core.slice(0, -1);
  return section.slice(0, span.from) + next + tail + section.slice(span.to);
}

/**
 * The code with one decimal place more or fewer in every section, which is what Excel's two buttons
 * do. General becomes `0.0` going up, as Excel's does for a value shown with no decimals, and stays
 * General going down. A date, a time or text has no decimals to change and is returned as it was.
 */
export function stepDecimals(code: string | undefined, delta: 1 | -1): string {
  if (!code || /^general$/i.test(code.trim())) return delta === 1 ? '0.0' : 'General';
  const cat = categoryOf(code);
  if (cat === 'text' || cat === 'date-short' || cat === 'date-long' || cat === 'time' || cat === 'custom') return code;
  if (cat === 'fraction') return code;
  return sections(code)
    .map((s) => stepSection(s, delta))
    .join(';');
}

/** The number of decimals the first section of a code shows, or null when it has no number. */
export function decimalsOf(code: string | undefined): number | null {
  if (!code || /^general$/i.test(code.trim())) return null;
  const span = numberSpan(sections(code)[0] ?? '');
  if (!span) return null;
  const num = (sections(code)[0] ?? '').slice(span.from, span.to).replace(/,+$/, '');
  const dot = num.indexOf('.');
  return dot < 0 ? 0 : num.length - dot - 1;
}
