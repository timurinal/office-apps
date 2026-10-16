/**
 * The web fonts a picture uses, as @font-face rules that carry their own bytes.
 *
 * A picture's SVG is also drawn as an image to make the PNG, and an SVG drawn as an image cannot
 * use the page's web fonts: it sees system fonts and nothing else. So the faces in use are written
 * into the file as data URLs. Only a face that comes from our own origin is embedded (the page's
 * policy is `font-src 'self'`, so that is Inter and JetBrains Mono); every other family is a font
 * the reader's machine already has, and is named in `font-family` with the stack's stand-ins, so
 * the picture shows it wherever it is installed and a stand-in where it is not.
 *
 * The rules are read from the page's stylesheets, the way the browser matches them: a face by
 * family, then the nearest weight CSS would pick, then the subsets whose `unicode-range` holds a
 * character the text has.
 */

export interface FontUse {
  /** The first family of the stack, unquoted. */
  family: string;
  /** 100 to 900. */
  weight: number;
  style: 'normal' | 'italic';
  /** Every character drawn in it. */
  chars: ReadonlySet<string>;
}

export interface FaceRule {
  family: string;
  /** The weights it covers: a static face is `[400, 400]`, a variable one `[100, 900]`. */
  weight: [number, number];
  style: string;
  /** Code point ranges, or null for all of them. */
  ranges: [number, number][] | null;
  url: string;
  format: string;
}

const norm = (family: string): string => family.trim().replace(/^["']|["']$/g, '').toLowerCase();

/** `U+0000-00FF, U+0131, U+4??` as ranges. */
export function parseRanges(text: string): [number, number][] | null {
  const out: [number, number][] = [];
  for (const part of text.split(',')) {
    const m = /^\s*U\+([0-9A-Fa-f?]{1,6})(?:-([0-9A-Fa-f]{1,6}))?\s*$/.exec(part);
    if (!m) continue;
    const a = m[1]!;
    if (a.includes('?')) out.push([Number.parseInt(a.replace(/\?/g, '0'), 16), Number.parseInt(a.replace(/\?/g, 'F'), 16)]);
    else out.push([Number.parseInt(a, 16), Number.parseInt(m[2] ?? a, 16)]);
  }
  return out.length ? out : null;
}

/** `400`, `bold`, or a range, `100 900`. */
export function parseWeight(text: string): [number, number] {
  const t = text.trim().toLowerCase();
  if (t === 'bold') return [700, 700];
  if (t === 'normal' || t === '') return [400, 400];
  const nums = t.split(/\s+/).map(Number).filter(Number.isFinite);
  return nums.length >= 2 ? [nums[0]!, nums[1]!] : nums.length === 1 ? [nums[0]!, nums[0]!] : [400, 400];
}

/** CSS font matching for a weight, over the weights a family has: 400 tries 500 first, 500 tries 400. */
export function nearestWeight(want: number, have: readonly number[]): number | null {
  if (!have.length) return null;
  if (have.includes(want)) return want;
  const above = have.filter((w) => w > want).sort((a, b) => a - b);
  const below = have.filter((w) => w < want).sort((a, b) => b - a);
  if (want > 500) return above[0] ?? below[0] ?? null;
  if (want < 400) return below[0] ?? above[0] ?? null;
  const between = have.filter((w) => w > want && w <= 500).sort((a, b) => a - b);
  return between[0] ?? below[0] ?? above[0] ?? null;
}

const covers = (ranges: [number, number][] | null, chars: ReadonlySet<string>): boolean => {
  if (!ranges) return true;
  for (const ch of chars) {
    const cp = ch.codePointAt(0)!;
    if (ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) return true;
  }
  return false;
};

/** The rules to embed for the fonts in use. */
export function pickFaces(rules: readonly FaceRule[], uses: readonly FontUse[]): FaceRule[] {
  const picked = new Set<FaceRule>();
  for (const use of uses) {
    const family = norm(use.family);
    const ofFamily = rules.filter((r) => norm(r.family) === family && r.style === use.style);
    // The weights are the static faces' own; a variable face answers any weight inside its range.
    const have = [...new Set(ofFamily.flatMap((r) => (r.weight[0] === r.weight[1] ? [r.weight[0]] : [])))];
    const variable = ofFamily.filter((r) => r.weight[0] !== r.weight[1] && r.weight[0] <= use.weight && use.weight <= r.weight[1]);
    const weight = nearestWeight(use.weight, have);
    for (const r of [...variable, ...ofFamily.filter((r) => r.weight[0] === r.weight[1] && r.weight[0] === weight)]) {
      if (covers(r.ranges, use.chars)) picked.add(r);
    }
  }
  return [...picked];
}

const URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)(?:\s*format\(\s*(['"]?)(.*?)\3\s*\))?/g;

/** The @font-face rules of the page's stylesheets that come from `origin`, following `@import`. */
export function faceRules(sheets: Iterable<CSSStyleSheet>, origin: string, base: string): FaceRule[] {
  const out: FaceRule[] = [];
  const seen = new Set<CSSStyleSheet>();
  const read = (sheet: CSSStyleSheet) => {
    if (seen.has(sheet)) return;
    seen.add(sheet);
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // A sheet from another origin cannot be read, and its fonts are not ours to embed.
      return;
    }
    for (const rule of Array.from(rules)) {
      if (typeof CSSImportRule !== 'undefined' && rule instanceof CSSImportRule) {
        if (rule.styleSheet) read(rule.styleSheet);
        continue;
      }
      if (typeof CSSFontFaceRule === 'undefined' || !(rule instanceof CSSFontFaceRule)) continue;
      const s = rule.style;
      const src = s.getPropertyValue('src');
      URL_RE.lastIndex = 0;
      const sources = [...src.matchAll(URL_RE)].map((m) => ({ href: m[2]!, format: (m[4] ?? '').toLowerCase() }));
      const best = sources.find((u) => u.format === 'woff2') ?? sources[0];
      if (!best || best.href.startsWith('data:')) continue;
      let url: URL;
      try {
        url = new URL(best.href, sheet.href ?? base);
      } catch {
        continue;
      }
      if (url.origin !== origin) continue;
      out.push({
        family: s.getPropertyValue('font-family'),
        weight: parseWeight(s.getPropertyValue('font-weight')),
        style: s.getPropertyValue('font-style').trim() || 'normal',
        ranges: parseRanges(s.getPropertyValue('unicode-range')),
        url: url.href,
        format: best.format || (/\.woff2(\?|$)/i.test(url.pathname) ? 'woff2' : /\.woff(\?|$)/i.test(url.pathname) ? 'woff' : /\.otf(\?|$)/i.test(url.pathname) ? 'opentype' : 'truetype')
      });
    }
  };
  for (const sheet of sheets) read(sheet);
  return out;
}

const MIME: Record<string, string> = { woff2: 'font/woff2', woff: 'font/woff', opentype: 'font/otf', truetype: 'font/ttf' };

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The @font-face rules for the fonts in use, with their bytes in them; empty where there is nothing of ours to embed. */
export async function embeddedFontCss(
  uses: readonly FontUse[],
  fetchBytes: (url: string) => Promise<Uint8Array | null> = defaultFetch,
  sheets: Iterable<CSSStyleSheet> = typeof document === 'undefined' ? [] : Array.from(document.styleSheets),
  origin = typeof location === 'undefined' ? '' : location.origin,
  base = typeof document === 'undefined' ? origin : document.baseURI
): Promise<string> {
  if (!uses.length) return '';
  const faces = pickFaces(faceRules(sheets, origin, base), uses);
  const css: string[] = [];
  const bytes = new Map<string, string | null>();
  for (const f of faces) {
    if (!bytes.has(f.url)) {
      const got = await fetchBytes(f.url);
      bytes.set(f.url, got ? toBase64(got) : null);
    }
    const data = bytes.get(f.url);
    if (!data) continue;
    const weight = f.weight[0] === f.weight[1] ? String(f.weight[0]) : `${f.weight[0]} ${f.weight[1]}`;
    const ranges = f.ranges ? `unicode-range:${f.ranges.map(([a, b]) => (a === b ? `U+${a.toString(16)}` : `U+${a.toString(16)}-${b.toString(16)}`)).join(',')};` : '';
    css.push(
      `@font-face{font-family:"${f.family.replace(/^["']|["']$/g, '').replace(/["\\]/g, '')}";font-style:${f.style};font-weight:${weight};${ranges}src:url(data:${MIME[f.format] ?? 'font/woff2'};base64,${data}) format("${f.format}")}`
    );
  }
  return css.join('\n');
}

async function defaultFetch(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
