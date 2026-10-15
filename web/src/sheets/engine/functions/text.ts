import type { Ctx, Value } from '../evaluate';
import { formatValue } from '../format';
import { type CellError, ERR, type Scalar, isError, parseNumber, toText } from '../values';
import { type Args, type FnDef, type FnTable, flat, given, hasWildcard, nums, roundHalfAway, wildcard } from './helpers';

const ANY = Infinity;
const MAX_TEXT = 32_767;

/** A function of one text argument. */
function t1(f: (s: string) => Scalar): FnDef {
  return {
    min: 1,
    max: 1,
    fn: ([v], ctx) => {
      const s = ctx.str(v);
      return isError(s) ? s : f(s);
    }
  };
}

function capped(s: string): string | CellError {
  return s.length > MAX_TEXT ? ERR.value : s;
}

function join(args: Args, delim: string, skipEmpty: boolean): string | CellError {
  const parts: string[] = [];
  for (const v of args) {
    for (const x of flat(v)) {
      if (isError(x)) return x;
      const s = toText(x) as string;
      if (skipEmpty && s === '') continue;
      parts.push(s);
    }
  }
  return capped(parts.join(delim));
}

// Windows-1252, which CHAR and CODE use as Excel on Windows does: 128 to 159 are not Latin-1.
const CP1252: Record<number, string> = {
  128: '€', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 134: '†', 135: '‡', 136: 'ˆ', 137: '‰', 138: 'Š', 139: '‹',
  140: 'Œ', 142: 'Ž', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—', 152: '˜', 153: '™',
  154: 'š', 155: '›', 156: 'œ', 158: 'ž', 159: 'Ÿ'
};
const FROM_CP1252 = new Map(Object.entries(CP1252).map(([k, v]) => [v, Number(k)]));

/** The nth (1-based, negative from the end) occurrence of `delim` in `s`; -1 if there is none. */
function occurrence(s: string, delim: string, n: number, ci: boolean): number {
  const hay = ci ? s.toLowerCase() : s;
  const d = ci ? delim.toLowerCase() : delim;
  if (n > 0) {
    let at = -d.length;
    for (let k = 0; k < n; k++) {
      at = hay.indexOf(d, at + Math.max(d.length, 1));
      if (at < 0) return -1;
    }
    return at;
  }
  let at = hay.length + Math.max(d.length, 1);
  for (let k = 0; k < -n; k++) {
    at = hay.lastIndexOf(d, at - Math.max(d.length, 1));
    if (at < 0) return -1;
  }
  return at;
}

function textAround(after: boolean): FnDef {
  return {
    min: 2,
    max: 6,
    fn: ([t, d, n, mode, end, nf], ctx) => {
      const s = ctx.str(t);
      if (isError(s)) return s;
      const delim = ctx.str(d);
      if (isError(delim)) return delim;
      // Written but empty, as in TEXTAFTER(t, d,,,, "none"), is the default, as in Excel's newer functions.
      const k = ctx.num(given(n) ? n : undefined, 1);
      if (isError(k)) return k;
      const ci = ctx.num(given(mode) ? mode : undefined, 0);
      if (isError(ci)) return ci;
      const matchEnd = ctx.bool(given(end) ? end : undefined, false);
      if (isError(matchEnd)) return matchEnd;
      const inst = Math.trunc(k);
      if (inst === 0 || Math.abs(inst) > s.length + 1) return ERR.value;
      if (delim === '') return after ? (inst > 0 ? s : '') : inst > 0 ? '' : s;
      let at = occurrence(s, delim, inst, ci === 1);
      let len = delim.length;
      // match_end treats the end of the text (or its start, counting back) as one more delimiter.
      if (at < 0 && matchEnd) {
        const found = occurrence(s, delim, inst > 0 ? inst - 1 : inst + 1, ci === 1);
        if (inst === 1 || inst === -1 || found >= 0) {
          at = inst > 0 ? s.length : 0;
          len = 0;
        }
      }
      if (at < 0) return given(nf) ? ctx.scalar(nf) : ERR.na;
      return after ? s.slice(at + len) : s.slice(0, at);
    }
  };
}

function fixed(n: number, decimals: number, noCommas: boolean): string {
  const r = roundHalfAway(n, decimals);
  const s = Math.abs(r).toFixed(Math.max(0, decimals));
  const [ip = '0', fp] = s.split('.');
  const grouped = noCommas ? ip : ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (r < 0 ? '-' : '') + grouped + (fp ? '.' + fp : '');
}

export const TEXT: FnTable = {
  LEN: t1((s) => s.length),
  LOWER: t1((s) => s.toLowerCase()),
  UPPER: t1((s) => s.toUpperCase()),
  // A letter is capitalised when what precedes it is not a letter: "o'neil 2-way" is "O'Neil 2-Way".
  PROPER: t1((s) => s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())),
  TRIM: t1((s) => s.replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ')),
  CLEAN: t1((s) => s.replace(/[\x00-\x1f]/g, '')),
  T: {
    min: 1,
    max: 1,
    fn: ([v], ctx) => {
      const x = ctx.scalar(v);
      return typeof x === 'string' || isError(x) ? x : '';
    }
  },
  LEFT: {
    min: 1,
    max: 2,
    fn: ([v, n], ctx) => {
      const s = ctx.str(v);
      if (isError(s)) return s;
      const k = ctx.num(n, 1);
      if (isError(k)) return k;
      return k < 0 ? ERR.value : s.slice(0, Math.trunc(k));
    }
  },
  RIGHT: {
    min: 1,
    max: 2,
    fn: ([v, n], ctx) => {
      const s = ctx.str(v);
      if (isError(s)) return s;
      const k = ctx.num(n, 1);
      if (isError(k)) return k;
      const i = Math.trunc(k);
      return k < 0 ? ERR.value : i === 0 ? '' : s.slice(-i);
    }
  },
  MID: {
    min: 3,
    max: 3,
    fn: ([v, a, n], ctx) => {
      const s = ctx.str(v);
      if (isError(s)) return s;
      const x = nums(ctx, a, n);
      if (isError(x)) return x;
      const [start, len] = [Math.trunc(x[0]!), Math.trunc(x[1]!)];
      if (start < 1 || len < 0) return ERR.value;
      return s.slice(start - 1, start - 1 + len);
    }
  },
  CONCAT: { min: 1, max: ANY, kinds: 'a', fn: (args) => join(args, '', false) },
  CONCATENATE: {
    min: 1,
    max: ANY,
    fn: (args, ctx) => {
      let out = '';
      for (const v of args) {
        const s = ctx.str(v);
        if (isError(s)) return s;
        out += s;
      }
      return capped(out);
    }
  },
  TEXTJOIN: {
    min: 3,
    max: ANY,
    kinds: 'ssa',
    fn: ([d, skip, ...rest], ctx) => {
      const delim = ctx.str(d);
      if (isError(delim)) return delim;
      const ig = ctx.bool(skip);
      if (isError(ig)) return ig;
      return join(rest, delim, ig);
    }
  },
  SUBSTITUTE: {
    min: 3,
    max: 4,
    fn: ([t, o, n, i], ctx) => {
      const s = ctx.str(t);
      if (isError(s)) return s;
      const old = ctx.str(o);
      if (isError(old)) return old;
      const nu = ctx.str(n);
      if (isError(nu)) return nu;
      if (old === '') return s;
      if (i === undefined) return capped(s.split(old).join(nu));
      const k = ctx.num(i);
      if (isError(k)) return k;
      if (Math.trunc(k) < 1) return ERR.value;
      const at = occurrence(s, old, Math.trunc(k), false);
      return at < 0 ? s : capped(s.slice(0, at) + nu + s.slice(at + old.length));
    }
  },
  REPLACE: {
    min: 4,
    max: 4,
    fn: ([t, a, n, r], ctx) => {
      const s = ctx.str(t);
      if (isError(s)) return s;
      const x = nums(ctx, a, n);
      if (isError(x)) return x;
      const nu = ctx.str(r);
      if (isError(nu)) return nu;
      const [start, len] = [Math.trunc(x[0]!), Math.trunc(x[1]!)];
      if (start < 1 || len < 0) return ERR.value;
      return capped(s.slice(0, start - 1) + nu + s.slice(start - 1 + len));
    }
  },
  FIND: find(false),
  SEARCH: find(true),
  REPT: {
    min: 2,
    max: 2,
    fn: ([t, n], ctx) => {
      const s = ctx.str(t);
      if (isError(s)) return s;
      const k = ctx.num(n);
      if (isError(k)) return k;
      if (k < 0 || s.length * Math.trunc(k) > MAX_TEXT) return ERR.value;
      return s.repeat(Math.trunc(k));
    }
  },
  EXACT: {
    min: 2,
    max: 2,
    fn: ([a, b], ctx) => {
      const x = ctx.str(a);
      if (isError(x)) return x;
      const y = ctx.str(b);
      return isError(y) ? y : x === y;
    }
  },
  VALUE: {
    min: 1,
    max: 1,
    fn: ([v], ctx) => {
      const x = ctx.scalar(v);
      if (typeof x === 'number' || isError(x)) return x;
      if (typeof x !== 'string' || x.trim() === '') return x === null ? 0 : ERR.value;
      return ctx.toNumber(x);
    }
  },
  TEXT: {
    min: 2,
    max: 2,
    fn: ([v, f], ctx) => {
      const x = ctx.scalar(v);
      if (isError(x)) return x;
      const code = ctx.str(f);
      if (isError(code)) return code;
      let value: Scalar = x;
      if (typeof x === 'string') {
        const n = ctx.toNumber(x);
        if (!isError(n)) value = n;
      }
      return formatValue(value, code).text;
    }
  },
  FIXED: {
    min: 1,
    max: 3,
    fn: ([v, d, c], ctx) => {
      const n = ctx.num(v);
      if (isError(n)) return n;
      const k = ctx.num(d, 2);
      if (isError(k)) return k;
      const nc = ctx.bool(c, false);
      if (isError(nc)) return nc;
      return fixed(n, Math.min(127, Math.trunc(k)), nc);
    }
  },
  CHAR: {
    min: 1,
    max: 1,
    fn: ([v], ctx) => {
      const n = ctx.num(v);
      if (isError(n)) return n;
      const k = Math.trunc(n);
      if (k < 1 || k > 255) return ERR.value;
      return CP1252[k] ?? String.fromCharCode(k);
    }
  },
  CODE: t1((s) => {
    if (!s) return ERR.value;
    const ch = s[0]!;
    const c = ch.charCodeAt(0);
    return FROM_CP1252.get(ch) ?? (c < 256 ? c : 63);
  }),
  UNICHAR: {
    min: 1,
    max: 1,
    fn: ([v], ctx) => {
      const n = ctx.num(v);
      if (isError(n)) return n;
      const k = Math.trunc(n);
      if (k < 1 || k > 0x10ffff) return ERR.value;
      if (k >= 0xd800 && k <= 0xdfff) return ERR.na;
      return String.fromCodePoint(k);
    }
  },
  UNICODE: t1((s) => (s ? s.codePointAt(0)! : ERR.value)),
  NUMBERVALUE: {
    min: 1,
    max: 3,
    fn: ([v, d, g], ctx) => {
      const s = ctx.str(v);
      if (isError(s)) return s;
      const dec = ctx.str(d, '.');
      if (isError(dec)) return dec;
      const grp = ctx.str(g, ',');
      if (isError(grp)) return grp;
      let t = s.replace(/\s+/g, '');
      if (grp) t = t.split(grp[0]!).join('');
      if (dec && dec[0] !== '.') t = t.replace(dec[0]!, '.');
      if (t === '') return 0;
      return parseNumber(t) ?? ERR.value;
    }
  },
  TEXTBEFORE: textAround(false),
  TEXTAFTER: textAround(true)
};

function find(search: boolean): FnDef {
  return {
    min: 2,
    max: 3,
    fn: ([f, w, n], ctx: Ctx): Value => {
      const needle = ctx.str(f);
      if (isError(needle)) return needle;
      const hay = ctx.str(w);
      if (isError(hay)) return hay;
      const k = ctx.num(n, 1);
      if (isError(k)) return k;
      const start = Math.trunc(k);
      if (start < 1 || start > hay.length + 1) return ERR.value;
      if (needle === '') return start;
      if (!search) {
        const at = hay.indexOf(needle, start - 1);
        return at < 0 ? ERR.value : at + 1;
      }
      if (!hasWildcard(needle)) {
        const at = hay.toLowerCase().indexOf(needle.toLowerCase(), start - 1);
        return at < 0 ? ERR.value : at + 1;
      }
      // SEARCH ignores case and takes wildcards; the pattern is unanchored at the end.
      const re = wildcard(needle + '*');
      for (let i = start - 1; i < hay.length; i++) if (re.test(hay.slice(i))) return i + 1;
      return ERR.value;
    }
  };
}
