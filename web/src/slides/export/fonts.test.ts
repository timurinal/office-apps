// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { embeddedFontCss, faceRules, nearestWeight, parseRanges, parseWeight, pickFaces, toBase64, type FaceRule, type FontUse } from './fonts';

const LATIN = parseRanges('U+0000-00FF, U+0131, U+2000-206F');
const EXT = parseRanges('U+0100-02BA, U+1E00-1E9F');
const face = (weight: number, ranges: [number, number][] | null, url: string, over: Partial<FaceRule> = {}): FaceRule => ({ family: "'Inter'", weight: [weight, weight], style: 'normal', ranges, url, format: 'woff2', ...over });
const RULES: FaceRule[] = [
  face(400, LATIN, 'http://o/inter-400-latin.woff2'),
  face(400, EXT, 'http://o/inter-400-latin-ext.woff2'),
  face(600, LATIN, 'http://o/inter-600-latin.woff2'),
  face(600, EXT, 'http://o/inter-600-latin-ext.woff2'),
  face(400, null, 'http://o/mono.woff2', { family: 'JetBrains Mono' })
];
const use = (family: string, weight: number, text: string, style: FontUse['style'] = 'normal'): FontUse => ({ family, weight, style, chars: new Set(text) });

describe('reading a face', () => {
  it('reads unicode-range, with wildcards, and says null for none', () => {
    expect(parseRanges('U+0000-00FF, U+0131, U+4??')).toEqual([[0, 255], [0x131, 0x131], [0x400, 0x4ff]]);
    expect(parseRanges('')).toBeNull();
    expect(parseRanges('nonsense')).toBeNull();
  });

  it('reads a weight, a keyword and a variable range', () => {
    expect(parseWeight('600')).toEqual([600, 600]);
    expect(parseWeight('bold')).toEqual([700, 700]);
    expect(parseWeight('normal')).toEqual([400, 400]);
    expect(parseWeight('100 900')).toEqual([100, 900]);
    expect(parseWeight('')).toEqual([400, 400]);
  });

  it('picks the weight CSS would: the nearest, heavier first above 500, 500 before 400 for 400', () => {
    expect(nearestWeight(600, [400, 500, 600])).toBe(600);
    expect(nearestWeight(700, [400, 500, 600])).toBe(600);
    expect(nearestWeight(700, [400])).toBe(400);
    expect(nearestWeight(300, [400, 500])).toBe(400);
    expect(nearestWeight(400, [500, 600])).toBe(500);
    expect(nearestWeight(400, [300, 600])).toBe(300);
    expect(nearestWeight(500, [400, 600])).toBe(400);
    expect(nearestWeight(400, [])).toBeNull();
  });
});

describe('the faces a picture needs', () => {
  it('takes the nearest weight of the family, and only the subsets that hold a character of the text', () => {
    const urls = (uses: FontUse[]) => pickFaces(RULES, uses).map((r) => r.url);
    expect(urls([use('Inter', 400, 'Hello')])).toEqual(['http://o/inter-400-latin.woff2']);
    expect(urls([use('Inter', 700, 'Hello')])).toEqual(['http://o/inter-600-latin.woff2']);
    expect(urls([use('Inter', 400, 'Hé Łódź')])).toEqual(['http://o/inter-400-latin.woff2', 'http://o/inter-400-latin-ext.woff2']);
    expect(urls([use('Inter', 400, 'Ł')])).toEqual(['http://o/inter-400-latin-ext.woff2']);
  });

  it('takes a face with no range whole, and each use once', () => {
    expect(pickFaces(RULES, [use('JetBrains Mono', 400, 'a'), use('jetbrains mono', 400, 'b')]).map((r) => r.url)).toEqual(['http://o/mono.woff2']);
  });

  it('takes nothing for a family that is not ours, or a style the family has not', () => {
    expect(pickFaces(RULES, [use('Georgia', 400, 'abc')])).toEqual([]);
    expect(pickFaces(RULES, [use('Inter', 400, 'abc', 'italic')])).toEqual([]);
  });

  it('answers a variable face at any weight inside its range', () => {
    const variable = face(0, LATIN, 'http://o/var.woff2', { weight: [100, 900] });
    expect(pickFaces([variable], [use('Inter', 650, 'a')])).toEqual([variable]);
    expect(pickFaces([variable], [use('Inter', 950, 'a')])).toEqual([]);
  });
});

describe('the page’s stylesheets', () => {
  const sheet = (css: string, href: string | null = null) => {
    const s = new CSSStyleSheet();
    s.replaceSync(css);
    if (href) Object.defineProperty(s, 'href', { value: href });
    return s;
  };

  it('are read for the faces from this origin, with their urls made whole', () => {
    const css = `
      @font-face { font-family: 'Inter'; font-weight: 600; font-style: normal; src: url(/fonts/inter-600-latin.woff2) format('woff2'); unicode-range: U+0000-00FF, U+0131; }
      @font-face { font-family: 'Elsewhere'; font-weight: 400; src: url(https://fonts.example.com/e.woff2) format('woff2'); }
      @font-face { font-family: 'Inlined'; font-weight: 400; src: url(data:font/woff2;base64,AAAA) format('woff2'); }
      body { color: red }`;
    const rules = faceRules([sheet(css)], 'http://app.test', 'http://app.test/slides/x');
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ weight: [600, 600], style: 'normal', url: 'http://app.test/fonts/inter-600-latin.woff2', format: 'woff2', ranges: [[0, 255], [0x131, 0x131]] });
    expect(rules[0]!.family).toMatch(/Inter/);
  });

  it('are written into the picture with their bytes, and a face that could not be fetched is left out', async () => {
    const css = `
      @font-face { font-family: 'Inter'; font-weight: 400; font-style: normal; src: url(/fonts/a.woff2) format('woff2'); unicode-range: U+0000-00FF; }
      @font-face { font-family: 'Inter'; font-weight: 400; font-style: normal; src: url(/fonts/b.woff2) format('woff2'); unicode-range: U+0100-024F; }`;
    const asked: string[] = [];
    const out = await embeddedFontCss(
      [use('Inter', 400, 'aŁ')],
      async (url) => {
        asked.push(url);
        return url.endsWith('a.woff2') ? new Uint8Array([1, 2, 3]) : null;
      },
      [sheet(css)],
      'http://app.test',
      'http://app.test/slides/x'
    );
    expect(asked).toEqual(['http://app.test/fonts/a.woff2', 'http://app.test/fonts/b.woff2']);
    expect(out).toContain('font-family:"Inter"');
    expect(out).toContain('font-weight:400');
    expect(out).toContain(`src:url(data:font/woff2;base64,${toBase64(new Uint8Array([1, 2, 3]))}) format("woff2")`);
    expect(out).toContain('unicode-range:U+0-ff');
    expect(out.split('@font-face').length - 1).toBe(1);
  });

  it('are not asked for when nothing in the picture uses a font', async () => {
    expect(await embeddedFontCss([], async () => new Uint8Array([1]), [], 'http://app.test')).toBe('');
  });
});

describe('bytes', () => {
  it('make base64 of any length', () => {
    expect(toBase64(new Uint8Array([72, 105]))).toBe('SGk=');
    expect(toBase64(new Uint8Array(100_000).fill(7)).length).toBe(Math.ceil(100_000 / 3) * 4);
  });
});
