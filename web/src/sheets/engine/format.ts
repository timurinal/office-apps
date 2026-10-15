/**
 * Excel's number formats: what a cell shows for its value and its format code.
 *
 * A code has up to four sections separated by `;`: positive, negative, zero,
 * text. With one section every number uses it; with two, the second is for
 * negatives and shows the absolute value (the code writes its own sign or
 * brackets). A section may start with a colour, [Red] or [Color10], and a
 * condition, [<1000], which replaces the positive/negative/zero rule; a number in
 * a conditional section keeps its sign.
 *
 * Covered: General; 0 # ? placeholders with literals between them (000-00-0000);
 * thousands separators and trailing-comma scaling; % ; scientific (0.00E+00,
 * ##0.0E+0); fractions (# ?/?, ?/8); dates and times with Excel's m-for-minute
 * rule, [h]:mm elapsed time, AM/PM, fractional seconds; @ for text; "quoted",
 * \escaped and _ spacing; * fill, returned as a marker for the renderer, since
 * only it knows the column width; [$€-809] currency.
 */

import { MAX_SERIAL, serialToDate, weekday } from './dates';
import type { Scalar } from './values';
import { isError } from './values';

export interface Formatted {
  text: string;
  /** A CSS colour from [Red] or [ColorN]. */
  color?: string;
  /** From `*x`: the cell repeats `char` at `at` to fill its width. */
  fill?: { char: string; at: number };
}

type Tok =
  | { t: 'lit'; s: string }
  | { t: 'digit'; ch: '0' | '#' | '?' }
  | { t: 'point' }
  | { t: 'comma' }
  | { t: 'pct' }
  | { t: 'exp'; s: string; plus: boolean }
  | { t: 'slash' }
  | { t: 'date'; k: 'y' | 'm' | 'd' | 'h' | 's' | 'min'; n: number }
  | { t: 'elapsed'; k: 'h' | 'm' | 's'; n: number }
  | { t: 'ampm'; s: string }
  | { t: 'subsec'; n: number }
  | { t: 'text' }
  | { t: 'fill'; ch: string }
  | { t: 'general' };

interface Cond {
  op: string;
  v: number;
}

type Kind = 'general' | 'number' | 'sci' | 'fraction' | 'date' | 'literal';

interface Section {
  toks: Tok[];
  kind: Kind;
  color?: string;
  cond?: Cond;
  hasText: boolean;
}

interface Parsed {
  sections: Section[];
  numeric: Section[];
  text?: Section;
  conditional: boolean;
}

const COLORS: Record<string, string> = {
  black: '#000000',
  blue: '#0000FF',
  cyan: '#00FFFF',
  green: '#00FF00',
  magenta: '#FF00FF',
  red: '#FF0000',
  white: '#FFFFFF',
  yellow: '#FFFF00'
};

/** Excel's default 56-colour palette, for [Color1] to [Color56]. */
const PALETTE = (
  '000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 800000 008000 000080 808000 800080 008080 C0C0C0 808080 ' +
  '9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF 000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF ' +
  '00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 ' +
  '003366 339966 003300 333300 993300 993366 333399 333333'
)
  .split(' ')
  .map((h) => `#${h}`);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------- parsing

function splitSections(code: string): string[] {
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

function parseSection(src: string): Section {
  const toks: Tok[] = [];
  let color: string | undefined;
  let cond: Cond | undefined;
  let i = 0;
  const lit = (s: string) => toks.push({ t: 'lit', s });
  while (i < src.length) {
    const ch = src[i]!;
    const rest = src.slice(i);
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      const stop = end < 0 ? src.length : end;
      lit(src.slice(i + 1, stop));
      i = stop + 1;
      continue;
    }
    if (ch === '\\') {
      lit(src[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (ch === '_') {
      lit(' ');
      i += 2;
      continue;
    }
    if (ch === '*') {
      toks.push({ t: 'fill', ch: src[i + 1] ?? ' ' });
      i += 2;
      continue;
    }
    if (ch === '[') {
      const end = src.indexOf(']', i);
      const body = src.slice(i + 1, end < 0 ? src.length : end);
      i = end < 0 ? src.length : end + 1;
      let m: RegExpExecArray | null;
      if (/^(h+|m+|s+)$/i.test(body)) toks.push({ t: 'elapsed', k: body[0]!.toLowerCase() as 'h', n: body.length });
      else if ((m = /^(<=|>=|<>|<|>|=)\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)$/i.exec(body))) cond = { op: m[1]!, v: Number(m[2]) };
      else if (body.startsWith('$')) {
        const sym = body.slice(1).split('-')[0]!;
        if (sym) lit(sym);
      } else if (COLORS[body.toLowerCase()]) color = COLORS[body.toLowerCase()];
      else if ((m = /^color\s*(\d+)$/i.exec(body))) color = PALETTE[Number(m[1]) - 1];
      continue;
    }
    if (/^general/i.test(rest)) {
      toks.push({ t: 'general' });
      i += 7;
      continue;
    }
    if (ch === '0' || ch === '#' || ch === '?') toks.push({ t: 'digit', ch });
    else if (ch === '.') toks.push({ t: 'point' });
    else if (ch === ',') toks.push({ t: 'comma' });
    else if (ch === '%') toks.push({ t: 'pct' });
    else if (ch === '/') toks.push({ t: 'slash' });
    else if (ch === '@') toks.push({ t: 'text' });
    else if ((ch === 'E' || ch === 'e') && (src[i + 1] === '+' || src[i + 1] === '-')) {
      toks.push({ t: 'exp', s: ch, plus: src[i + 1] === '+' });
      i += 2;
      continue;
    } else if (/^am\/pm/i.test(rest)) {
      toks.push({ t: 'ampm', s: rest.slice(0, 5) });
      i += 5;
      continue;
    } else if (/^a\/p/i.test(rest)) {
      toks.push({ t: 'ampm', s: rest.slice(0, 3) });
      i += 3;
      continue;
    } else if ('ymdhs'.includes(ch.toLowerCase())) {
      const k = ch.toLowerCase() as 'y';
      let n = 1;
      while (src[i + n]?.toLowerCase() === k) n++;
      toks.push({ t: 'date', k, n });
      i += n;
      continue;
    } else lit(ch);
    i++;
  }
  const hasText = toks.some((t) => t.t === 'text');
  const isDate = toks.some((t) => t.t === 'date' || t.t === 'elapsed' || t.t === 'ampm');
  let kind: Kind;
  if (isDate) {
    resolveDate(toks);
    kind = 'date';
  } else if (toks.some((t) => t.t === 'general')) kind = 'general';
  else if (!toks.some((t) => t.t === 'digit')) kind = 'literal';
  else if (toks.some((t) => t.t === 'exp')) kind = 'sci';
  else if (toks.some((t) => t.t === 'slash')) kind = 'fraction';
  else kind = 'number';
  const s: Section = { toks, kind, hasText };
  if (color) s.color = color;
  if (cond) s.cond = cond;
  return s;
}

/** m after an hour or before a second is minutes; `.00` after seconds is fractions of one. */
function resolveDate(toks: Tok[]): void {
  const isTime = (t: Tok | undefined, k: string) => !!t && (t.t === 'date' || t.t === 'elapsed') && t.k === k;
  const near = (i: number, step: number): Tok | undefined => {
    for (let j = i + step; j >= 0 && j < toks.length; j += step) {
      const t = toks[j]!;
      if (t.t === 'date' || t.t === 'elapsed') return t;
    }
    return undefined;
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.t === 'date' && t.k === 'm' && t.n <= 2 && (isTime(near(i, -1), 'h') || isTime(near(i, 1), 's'))) {
      toks[i] = { t: 'date', k: 'min', n: t.n };
    }
    if (t.t === 'point' && isTime(near(i, -1), 's') && toks[i + 1]?.t === 'digit') {
      let n = 0;
      while (toks[i + 1 + n]?.t === 'digit') n++;
      toks.splice(i, 1 + n, { t: 'subsec', n });
    }
  }
}

const cache = new Map<string, Parsed>();

function parse(code: string): Parsed {
  let p = cache.get(code);
  if (p) return p;
  const sections = splitSections(code).slice(0, 4).map(parseSection);
  let text: Section | undefined;
  if (sections.length === 4) text = sections[3];
  else for (const s of sections) if (s.hasText) text = s;
  const numeric = sections.slice(0, 3).filter((s) => s !== text);
  p = { sections, numeric, conditional: sections.some((s) => s.cond) };
  if (text) p.text = text;
  if (cache.size >= 1000) cache.clear();
  cache.set(code, p);
  return p;
}

// ---------------------------------------------------------------- General

function sci(v: number, digits: number): string {
  const [m = '0', e = '0'] = v.toExponential(digits).split('e');
  const mant = m.includes('.') ? m.replace(/\.?0+$/, '') : m;
  const n = Number(e);
  return `${mant}E${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
}

const strip = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);

/** General: as many digits as fit in an 11-character cell, then scientific; ported from SSF's rules. */
export function general(v: number): string {
  if (v === 0) return '0';
  if (!Number.isFinite(v)) return '#NUM!';
  const V = Math.floor(Math.log10(Math.abs(v)));
  if (V >= -4 && V <= -1) return strip(v.toPrecision(10 + V));
  if (Math.abs(V) <= 9) {
    const w = v < 0 ? 12 : 11;
    let o = strip(v.toFixed(12));
    if (o.length <= w) return o;
    o = v.toPrecision(10);
    if (!o.includes('e')) {
      o = strip(o);
      if (o.length <= w) return o;
    }
    return sci(v, 5);
  }
  if (V === 10) {
    const r = Math.round(v);
    return Math.abs(r) >= 1e11 ? sci(v, 5) : String(r);
  }
  return sci(v, 5);
}

// ---------------------------------------------------------------- numbers

function roundTo(x: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(parseFloat((x * f).toPrecision(15))) / f;
}

/** The integer placeholders' text, right-aligned: extra digits go to the first. */
function placeInt(kinds: string[], digits: string): string[] {
  const out = kinds.map(() => '');
  let d = digits.length - 1;
  for (let j = kinds.length - 1; j >= 0; j--) {
    const k = kinds[j]!;
    if (d >= 0) out[j] = digits[d--]!;
    else out[j] = k === '0' ? '0' : k === '?' ? ' ' : '';
  }
  if (d >= 0 && kinds.length) out[0] = digits.slice(0, d + 1) + out[0];
  return out;
}

/** Decimal placeholders: # drops a trailing zero and ? turns it into a space, until a 0 or a non-zero digit. */
function placeFrac(kinds: string[], digits: string): string[] {
  const out = kinds.map((_, j) => digits[j] ?? '0');
  for (let j = kinds.length - 1; j >= 0; j--) {
    if (kinds[j] === '0' || out[j] !== '0') break;
    out[j] = kinds[j] === '?' ? ' ' : '';
  }
  return out;
}

function group(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

interface Layout {
  intIdx: number[];
  fracIdx: number[];
  point: number;
  grouped: boolean;
  scale: number;
  pct: number;
  /** Commas that are separators or scaling, and so print nothing where they stand. */
  silent: Set<number>;
}

function layout(toks: Tok[], from = 0, to = toks.length): Layout {
  const l: Layout = { intIdx: [], fracIdx: [], point: -1, grouped: false, scale: 0, pct: 0, silent: new Set() };
  for (let i = from; i < to; i++) {
    const t = toks[i]!;
    if (t.t === 'point' && l.point < 0) l.point = i;
    else if (t.t === 'digit') (l.point < 0 ? l.intIdx : l.fracIdx).push(i);
    else if (t.t === 'pct') l.pct++;
  }
  const lastDigit = Math.max(l.intIdx[l.intIdx.length - 1] ?? -1, l.fracIdx[l.fracIdx.length - 1] ?? -1);
  for (let i = from; i < to; i++) {
    if (toks[i]!.t !== 'comma') continue;
    const prev = toks[i - 1];
    const next = toks[i + 1];
    if (prev?.t === 'digit' && next?.t === 'digit' && (l.point < 0 || i < l.point)) {
      l.grouped = true;
      l.silent.add(i);
    } else if (i > (l.intIdx[0] ?? Infinity)) {
      // Trailing commas after the last placeholder scale by a thousand each.
      let j = i - 1;
      while (j >= from && toks[j]!.t === 'comma') j--;
      if (j === lastDigit || (toks[j]?.t === 'point' && j === l.point && l.fracIdx.length === 0)) {
        l.scale++;
        l.silent.add(i);
      }
    }
  }
  return l;
}

function renderNumber(toks: Tok[], x: number, neg: boolean): string {
  const l = layout(toks);
  let v = x * Math.pow(100, l.pct) / Math.pow(1000, l.scale);
  const decimals = l.fracIdx.length;
  v = roundTo(v, decimals);
  const fixed = v >= 1e21 ? general(v) : v.toFixed(decimals);
  const [ip = '', fp = ''] = fixed.split('.');
  const intDigits = ip === '0' ? '' : ip;
  const intKinds = l.intIdx.map((i) => (toks[i] as { ch: string }).ch);
  let intOut: string[];
  if (l.grouped) {
    // Separators apply to the whole integer part, which is placed at the first placeholder.
    const zeros = intKinds.filter((k) => k === '0').length;
    const padded = intDigits.padStart(zeros, '0');
    intOut = intKinds.map(() => '');
    if (intOut.length) intOut[0] = group(padded);
  } else intOut = placeInt(intKinds, intDigits);
  const fracOut = placeFrac(
    l.fracIdx.map((i) => (toks[i] as { ch: string }).ch),
    fp
  );
  let s = '';
  const intAt = new Map(l.intIdx.map((t, j) => [t, intOut[j]!]));
  const fracAt = new Map(l.fracIdx.map((t, j) => [t, fracOut[j]!]));
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.t === 'digit') s += intAt.get(i) ?? fracAt.get(i) ?? '';
    else if (t.t === 'point') s += (l.intIdx.length === 0 && i === l.point ? intDigits : '') + '.';
    else if (t.t === 'comma') s += l.silent.has(i) ? '' : ',';
    else s += tokText(t);
  }
  return (neg && v !== 0 ? '-' : '') + s;
}

function renderSci(toks: Tok[], x: number, neg: boolean): string {
  const e = toks.findIndex((t) => t.t === 'exp');
  const et = toks[e] as Extract<Tok, { t: 'exp' }>;
  const l = layout(toks, 0, e);
  const ip = Math.max(1, l.intIdx.length);
  const decimals = l.fracIdx.length;
  const engineering = l.intIdx.length > 1 && l.intIdx.some((i) => (toks[i] as { ch: string }).ch === '#');
  let exp = 0;
  let m = 0;
  if (x !== 0) {
    exp = Math.floor(Math.log10(x));
    exp = engineering ? Math.floor(exp / ip) * ip : exp - (ip - 1);
    m = roundTo(x / Math.pow(10, exp), decimals);
    if (m >= Math.pow(10, ip)) {
      exp += engineering ? ip : 1;
      m = roundTo(x / Math.pow(10, exp), decimals);
    }
  }
  const mant = renderNumber(toks.slice(0, e), m, false);
  const expDigits = toks.slice(e + 1).filter((t) => t.t === 'digit').length;
  const sign = exp < 0 ? '-' : et.plus ? '+' : '';
  let tail = '';
  let placed = false;
  for (const t of toks.slice(e + 1)) {
    if (t.t === 'digit') {
      if (!placed) tail += String(Math.abs(exp)).padStart(expDigits, '0');
      placed = true;
    } else tail += tokText(t);
  }
  return (neg && m !== 0 ? '-' : '') + mant + et.s + sign + tail;
}

/** The closest fraction with a denominator at most `maxD`, by continued fractions. */
function approximate(x: number, maxD: number): [number, number] {
  let p0 = 0;
  let q0 = 1;
  let p1 = 1;
  let q1 = 0;
  let z = x;
  for (let guard = 0; guard < 64; guard++) {
    const a = Math.floor(z);
    const p2 = a * p1 + p0;
    const q2 = a * q1 + q0;
    if (q2 > maxD) break;
    [p0, q0, p1, q1] = [p1, q1, p2, q2];
    if (z - a < 1e-12) break;
    z = 1 / (z - a);
  }
  if (q1 === 0) return [Math.round(x), 1];
  const k = Math.floor((maxD - q0) / q1);
  const ps = p0 + k * p1;
  const qs = q0 + k * q1;
  return qs > 0 && Math.abs(x - ps / qs) < Math.abs(x - p1 / q1) ? [ps, qs] : [p1, q1];
}

function renderFraction(toks: Tok[], x: number, neg: boolean): string {
  const slash = toks.findIndex((t) => t.t === 'slash');
  // The numerator is the run of placeholders just before the slash; any placeholders before that are the whole part.
  let ns = slash;
  while (ns > 0 && toks[ns - 1]!.t === 'digit') ns--;
  const numKinds = toks.slice(ns, slash).map((t) => (t as { ch: string }).ch);
  const wholeIdx: number[] = [];
  for (let i = 0; i < ns; i++) if (toks[i]!.t === 'digit') wholeIdx.push(i);
  let de = slash + 1;
  let fixedDen = '';
  const denKinds: string[] = [];
  while (de < toks.length) {
    const t = toks[de]!;
    if (t.t === 'digit') denKinds.push(t.ch);
    else if (t.t === 'lit' && /^\d+$/.test(t.s) && !denKinds.length) fixedDen += t.s;
    else break;
    de++;
  }
  let whole = wholeIdx.length ? Math.floor(x) : 0;
  const rest = wholeIdx.length ? x - whole : x;
  let num: number;
  let den: number;
  if (fixedDen) {
    den = Number(fixedDen);
    num = Math.round(rest * den);
  } else {
    [num, den] = approximate(rest, Math.pow(10, Math.max(1, denKinds.length)) - 1);
  }
  if (wholeIdx.length && num === den) {
    whole++;
    num = 0;
  }
  const blank = wholeIdx.length > 0 && num === 0;
  const wholeOut = placeInt(
    wholeIdx.map((i) => (toks[i] as { ch: string }).ch),
    whole === 0 && !blank ? '' : String(whole)
  );
  const numText = blank ? ' '.repeat(Math.max(numKinds.length, 1)) : String(num).padStart(numKinds.length, ' ');
  const denText = blank ? ' '.repeat(Math.max(denKinds.length || fixedDen.length, 1)) : fixedDen || String(den).padEnd(denKinds.length, ' ');
  let s = '';
  let w = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (i >= ns && i < slash) {
      if (i === ns) s += numText;
    } else if (i === slash) s += blank ? ' ' : '/';
    else if (i > slash && i < de) {
      if (i === slash + 1) s += denText;
    } else if (t.t === 'digit') s += wholeOut[w++] ?? '';
    else s += tokText(t);
  }
  // With no whole part to show, the space that separated it goes too.
  if (wholeIdx.length && whole === 0 && !blank) s = s.replace(/^\s+/, '');
  return (neg && (whole !== 0 || num !== 0) ? '-' : '') + s;
}

// ---------------------------------------------------------------- dates

function renderDate(toks: Tok[], v: number): string {
  if (v < 0 || v >= MAX_SERIAL + 1) return '#'.repeat(10);
  let sd = 0;
  for (const t of toks) if (t.t === 'subsec') sd = Math.max(sd, t.n);
  const perDay = 86_400 * Math.pow(10, sd);
  const units = Math.round(v * perDay);
  const days = Math.floor(units / perDay);
  const rem = units - days * perDay;
  const secs = Math.floor(rem / Math.pow(10, sd));
  const sub = rem - secs * Math.pow(10, sd);
  const h = Math.floor(secs / 3600);
  const min = Math.floor(secs / 60) % 60;
  const s = secs % 60;
  const date = serialToDate(days);
  const ampm = toks.some((t) => t.t === 'ampm');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  let out = '';
  for (const t of toks) {
    switch (t.t) {
      case 'date':
        switch (t.k) {
          case 'y':
            out += t.n <= 2 ? pad(date.y % 100, 2) : String(date.y);
            break;
          case 'm':
            out +=
              t.n === 1 ? String(date.m) : t.n === 2 ? pad(date.m, 2) : t.n === 3 ? MONTHS[date.m - 1]!.slice(0, 3) : t.n === 5 ? MONTHS[date.m - 1]![0] : MONTHS[date.m - 1];
            break;
          case 'd': {
            const name = DAYS[weekday(days) - 1]!;
            out += t.n === 1 ? String(date.d) : t.n === 2 ? pad(date.d, 2) : t.n === 3 ? name.slice(0, 3) : name;
            break;
          }
          case 'h':
            out += pad(ampm ? h12 : h, Math.min(t.n, 2));
            break;
          case 'min':
            out += pad(min, Math.min(t.n, 2));
            break;
          case 's':
            out += pad(s, Math.min(t.n, 2));
            break;
        }
        break;
      case 'elapsed': {
        const total = t.k === 'h' ? days * 24 + h : t.k === 'm' ? (days * 24 + h) * 60 + min : ((days * 24 + h) * 60 + min) * 60 + s;
        out += pad(total, t.n);
        break;
      }
      case 'subsec':
        out += '.' + pad(sub, sd).slice(0, t.n);
        break;
      case 'ampm': {
        const pm = h >= 12;
        const lower = t.s[0] === 'a' || t.s[0] === 'p';
        const word = t.s.length === 3 ? (pm ? 'P' : 'A') : pm ? 'PM' : 'AM';
        out += lower ? word.toLowerCase() : word;
        break;
      }
      case 'digit':
        out += t.ch;
        break;
      case 'point':
        out += '.';
        break;
      case 'comma':
        out += ',';
        break;
      default:
        out += tokText(t);
    }
  }
  return out;
}

function tokText(t: Tok): string {
  switch (t.t) {
    case 'lit':
      return t.s;
    case 'pct':
      return '%';
    case 'slash':
      return '/';
    case 'comma':
      return ',';
    case 'point':
      return '.';
    case 'digit':
      return t.ch;
    case 'fill':
      return FILL;
    default:
      return '';
  }
}

/** Stands where a `*x` fill goes until withFill takes it out and records the position. */
const FILL = '\u0000';

// ---------------------------------------------------------------- the entry point

function testCond(c: Cond, v: number): boolean {
  switch (c.op) {
    case '<':
      return v < c.v;
    case '>':
      return v > c.v;
    case '<=':
      return v <= c.v;
    case '>=':
      return v >= c.v;
    case '=':
      return v === c.v;
    default:
      return v !== c.v;
  }
}

/** The section a number uses, and whether it shows the number's sign itself. */
function choose(p: Parsed, v: number): { sec: Section; signed: boolean } | undefined {
  const s = p.numeric;
  if (!s.length) return undefined;
  if (p.conditional) {
    if (s[0]!.cond ? testCond(s[0]!.cond, v) : v >= 0) return { sec: s[0]!, signed: true };
    if (s[1] && (!s[1].cond || testCond(s[1].cond, v))) return { sec: s[1], signed: true };
    return s[2] ? { sec: s[2], signed: true } : undefined;
  }
  if (s.length === 1) return { sec: s[0]!, signed: true };
  if (v < 0) return { sec: s[1]!, signed: false };
  if (v === 0 && s[2]) return { sec: s[2], signed: false };
  return { sec: s[0]!, signed: false };
}

function withFill(sec: Section, text: string): Formatted {
  const at = text.indexOf(FILL);
  const out: Formatted = { text: at < 0 ? text : text.replace(FILL, '') };
  if (sec.color) out.color = sec.color;
  if (at >= 0) out.fill = { char: (sec.toks.find((t) => t.t === 'fill') as { ch: string }).ch, at };
  return out;
}

function formatNumber(v: number, code: string): Formatted {
  const p = parse(code);
  const pick = choose(p, v);
  if (!pick) return { text: p.numeric.length ? '#'.repeat(10) : general(v) };
  const { sec, signed } = pick;
  const neg = signed && v < 0;
  const x = Math.abs(v);
  let text: string;
  switch (sec.kind) {
    case 'general':
      text = sec.toks.map((t) => (t.t === 'general' ? general(signed ? v : x) : tokText(t))).join('');
      break;
    case 'literal':
      text = (neg ? '-' : '') + sec.toks.map(tokText).join('');
      break;
    case 'date':
      text = renderDate(sec.toks, signed ? v : x);
      break;
    case 'sci':
      text = renderSci(sec.toks, x, neg);
      break;
    case 'fraction':
      text = renderFraction(sec.toks, x, neg);
      break;
    default:
      text = renderNumber(sec.toks, x, neg);
  }
  return withFill(sec, text);
}

/** What a cell shows for a value under a format code. No code, or "General", is General. */
export function formatValue(v: Scalar, code?: string): Formatted {
  if (v === null) return { text: '' };
  if (isError(v)) return { text: v.code };
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE' };
  const general_ = !code || /^general$/i.test(code.trim());
  if (typeof v === 'number') return general_ ? { text: general(v) } : formatNumber(v, code);
  if (general_) return { text: v };
  const sec = parse(code).text;
  if (!sec) return { text: v };
  return withFill(sec, sec.toks.map((t) => (t.t === 'text' ? v : tokText(t))).join(''));
}

/** True when a code shows numbers as dates or times, so an editor can offer a date picker. */
export function isDateFormat(code: string | undefined): boolean {
  return !!code && parse(code).numeric[0]?.kind === 'date';
}
