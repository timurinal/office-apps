/**
 * Excel's 1900 date system. A date is a serial: whole days since 0 January 1900,
 * with the time of day as the fraction.
 *
 * Excel believes 1900 was a leap year (Lotus 1-2-3 did, and Excel kept the bug for
 * compatibility), so serial 60 is 29 February 1900, a day that never happened, and
 * every serial before it is one day off the real calendar. Everything here works
 * in Excel's calendar, so DATE(1900,2,29) is 60 and DAY(60) is 29, as Excel says.
 */

const DAY_MS = 86_400_000;
/** Serial 0 on the real calendar for serials >= 61: 30 December 1899. */
const EPOCH = Date.UTC(1899, 11, 30);
/** 31 December 9999, the last date Excel shows. */
export const MAX_SERIAL = 2_958_465;

/** First of each month in 1900, as Excel counts it (February has 29 days). */
const FIRSTS_1900 = [1, 32, 61, 92, 122, 153, 183, 214, 245, 275, 306, 336];

export function isLeapYear(y: number): boolean {
  return y === 1900 || (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
}

export function daysInMonth(y: number, m: number): number {
  return m === 2 ? (isLeapYear(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/**
 * DATE(y, m, d) with Excel's overflow rules: month 13 is next January, day 0 the
 * last day of the month before. Years 0 to 1899 mean 1900 to 3799. NaN when the
 * result is before 1900 or after 9999, which DATE answers with #NUM!.
 */
export function dateToSerial(y: number, m: number, d: number): number {
  if (y >= 0 && y < 1900) y += 1900;
  y += Math.floor((m - 1) / 12);
  m = ((((m - 1) % 12) + 12) % 12) + 1;
  if (y < 1900 || y > 9999) return NaN;
  const first = y === 1900 ? FIRSTS_1900[m - 1]! : Math.round((Date.UTC(y, m - 1, 1) - EPOCH) / DAY_MS);
  const serial = first + d - 1;
  return serial < 0 || serial > MAX_SERIAL ? NaN : serial;
}

export interface DateParts {
  y: number;
  m: number;
  d: number;
}

/** The calendar date of a serial's whole part. Serial 0 is 0 January 1900. */
export function serialToDate(serial: number): DateParts {
  const whole = Math.floor(serial);
  if (whole === 0) return { y: 1900, m: 1, d: 0 };
  if (whole === 60) return { y: 1900, m: 2, d: 29 };
  const dt = new Date(EPOCH + (whole < 60 ? whole + 1 : whole) * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export interface TimeParts {
  h: number;
  min: number;
  s: number;
}

/** The time of day, rounded to the nearest second as HOUR, MINUTE and SECOND do. */
export function serialToTime(serial: number): TimeParts {
  let secs = Math.round((serial - Math.floor(serial)) * 86_400);
  if (secs >= 86_400) secs = 0;
  return { h: Math.floor(secs / 3600), min: Math.floor(secs / 60) % 60, s: secs % 60 };
}

/** 1 for Sunday to 7 for Saturday, by Excel's calendar (so 1 January 1900 is a Sunday). */
export function weekday(serial: number): number {
  return ((((Math.floor(serial) - 1) % 7) + 7) % 7) + 1;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(timeZone: string, ms: number) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23'
    });
    formatters.set(timeZone, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(ms)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

/** Today's serial in a time zone; a workbook carries one, so TODAY() agrees for everyone in it. */
export function todaySerial(timeZone: string, ms: number): number {
  const p = partsIn(timeZone, ms);
  return dateToSerial(p.year ?? 1900, p.month ?? 1, p.day ?? 1);
}

export function nowSerial(timeZone: string, ms: number): number {
  const p = partsIn(timeZone, ms);
  const day = dateToSerial(p.year ?? 1900, p.month ?? 1, p.day ?? 1);
  return day + ((p.hour ?? 0) * 3600 + (p.minute ?? 0) * 60 + (p.second ?? 0)) / 86_400;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function monthFromName(s: string): number | undefined {
  const i = MONTHS.indexOf(s.slice(0, 3).toLowerCase());
  if (i < 0) return undefined;
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][i]!;
  return s.length <= 3 || full.startsWith(s.toLowerCase()) || s.toLowerCase() === 'sept' ? i + 1 : undefined;
}

/** How a slashed date such as 3/4/2024 is read: day first (the UK) or month first (the US). */
export type DateOrder = 'dmy' | 'mdy';

export interface ParsedDateTime {
  serial: number;
  /** The format a typed value of this shape gets, so it shows back as typed. */
  format: string;
}

const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*([ap]\.?m\.?)?$/i;

function parseTime(s: string): { frac: number; format: string } | undefined {
  const m = TIME.exec(s.trim());
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] ? Number(m[3]) : 0;
  const ampm = m[4]?.[0]?.toLowerCase();
  if (min > 59 || sec >= 60) return undefined;
  if (ampm) {
    if (h < 1 || h > 12) return undefined;
    h = (h % 12) + (ampm === 'p' ? 12 : 0);
  } else if (h > 23) return undefined;
  const format = (m[3] ? 'h:mm:ss' : 'h:mm') + (ampm ? ' AM/PM' : '');
  return { frac: (h * 3600 + min * 60 + sec) / 86_400, format };
}

function parseDate(s: string, order: DateOrder): ParsedDateTime | undefined {
  const t = s.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!, 'yyyy-mm-dd');
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (m) {
    const [a, b] = [+m[1]!, +m[2]!];
    const y = fullYear(m[3]!);
    return order === 'dmy' ? valid(y, b, a, 'dd/mm/yyyy') : valid(y, a, b, 'mm/dd/yyyy');
  }
  // 15 Jan 2024, 15-Jan-2024, 15 January 2024
  m = /^(\d{1,2})[\s-]+([A-Za-z]+)\.?[\s-]+(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const mo = monthFromName(m[2]!);
    return mo ? valid(fullYear(m[3]!), mo, +m[1]!, 'd mmm yyyy') : undefined;
  }
  // Jan 15, 2024; January 15 2024
  m = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (m) {
    const mo = monthFromName(m[1]!);
    return mo ? valid(+m[3]!, mo, +m[2]!, 'mmm d, yyyy') : undefined;
  }
  return undefined;
}

function fullYear(s: string): number {
  const y = Number(s);
  // Excel's two-digit window: 00-29 are 2000s, 30-99 are 1900s.
  return s.length === 2 ? (y < 30 ? 2000 + y : 1900 + y) : y;
}

function valid(y: number, m: number, d: number, format: string): ParsedDateTime | undefined {
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return undefined;
  const serial = dateToSerial(y, m, d);
  return Number.isNaN(serial) ? undefined : { serial, format };
}

/** A date, a time, or a date and time written as text, as Excel recognises them. */
export function parseDateTime(s: string, order: DateOrder = 'dmy'): ParsedDateTime | undefined {
  const t = s.trim();
  if (t === '' || t.length > 40) return undefined;
  const time = parseTime(t);
  if (time) return { serial: time.frac, format: time.format };
  const date = parseDate(t, order);
  if (date) return date;
  // A date and a time: "2024-01-15 14:30", "15/01/2024 2:30 PM", "2024-01-15T14:30:00".
  const m = /^(.+?)(?:\s+|T)(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*[ap]\.?m\.?)?)$/i.exec(t);
  if (!m) return undefined;
  const d = parseDate(m[1]!, order);
  const tm = parseTime(m[2]!);
  return d && tm ? { serial: d.serial + tm.frac, format: `${d.format} ${tm.format}` } : undefined;
}
