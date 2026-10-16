import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The page colour is CSS, so what keeps it honest is read from the CSS: that a white page and a dark
 * page are the app's own light and dark tokens (drift between the two is a page that is not the
 * colour it says), and that the colours a document set are only ever remapped on a screen. Print is
 * the base, white, whatever the reader's choice or theme was.
 */

interface Rule {
  selector: string;
  body: string;
  media: string | null;
}

function parse(css: string): Rule[] {
  const out: Rule[] = [];
  const walk = (src: string, media: string | null) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (depth > 0 && j < src.length) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      const inner = src.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(inner, head);
      else if (!head.startsWith('@')) out.push({ selector: head.replace(/\s+/g, ' '), body: inner, media });
      i = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), null);
  return out;
}

const read = (p: string) => parse(readFileSync(join(process.cwd(), 'web', p), 'utf8'));
const doc = read('src/docs/doc.css');
const styles = read('src/styles.css');
const ds = read('public/_ds/base/tokens/colors.css');

/** A selector that applies only to a sepia or a dark page. `:not([data-page='dark'])` is the white page's. */
const NAMES_ANOTHER_PAGE = /(?<!:not\()\[data-page='(sepia|dark)'\]/;

const decl = (rule: Rule | undefined, name: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+)`).exec(rule?.body ?? '')?.[1]?.trim();

const ramp = new Map<string, string>();
for (const m of ds.find((r) => r.selector === ':root')!.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) ramp.set(m[1]!, m[2]!.trim());
const resolve = (v: string | undefined): string | undefined => {
  const m = v && /^var\((--[\w-]+)\)$/.exec(v);
  return m ? ramp.get(m[1]!) : v;
};

const TOKENS = ['--paper', '--fg-1', '--fg-2', '--fg-3', '--fg-4', '--bd', '--bd-soft', '--bd-faint', '--field', '--rule'];
const DS_TOKENS = ['--text-quiet', '--surface-code'];

const page = (tone: string) => doc.find((r) => r.selector === (tone === 'white' ? 'article.oa-paper > :not(.rv-margin)' : `article.oa-paper[data-page='${tone}'] > :not(.rv-margin)`));
const light = styles.find((r) => r.selector === ':root' && /--fg-1/.test(r.body));
const dark = styles.find((r) => r.selector === "[data-theme='dark']" && /--fg-1/.test(r.body));
const dsDark = ds.find((r) => r.selector === '[data-theme="dark"]');
const dsLight = ds.find((r) => r.selector === ':root');

describe('doc.css page colour', () => {
  it('has a page for each colour', () => {
    for (const tone of ['white', 'sepia', 'dark']) expect(page(tone), tone).toBeDefined();
  });

  it("makes a white page of the app's light tokens, so it is the same page in either theme", () => {
    for (const t of TOKENS) expect(decl(page('white'), t), t).toBe(decl(light, t));
    for (const t of DS_TOKENS) expect(resolve(decl(page('white'), t)), t).toBe(resolve(decl(dsLight, t)));
  });

  it("makes a dark page of the app's dark tokens", () => {
    for (const t of TOKENS) expect(decl(page('dark'), t), t).toBe(decl(dark, t));
    for (const t of DS_TOKENS) expect(resolve(decl(page('dark'), t)), t).toBe(resolve(decl(dsDark, t)));
  });

  it('has the same tokens on every page, so one cannot be left on another page’s colour', () => {
    const names = (r: Rule | undefined) => [...(r?.body ?? '').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!);
    const white = new Set(names(page('white')));
    for (const tone of ['sepia', 'dark']) {
      for (const n of names(page(tone))) expect(white.has(n), `${tone} sets ${n}`).toBe(true);
    }
    for (const n of ['--paper', ...TOKENS, ...DS_TOKENS, '--selection-bg', '--doc-link', '--doc-mention-bg']) {
      expect(names(page('sepia')).includes(n) || n === '--surface-code', `sepia sets ${n}`).toBe(true);
    }
  });

  it('leaves the margin cards to the app', () => {
    for (const tone of ['white', 'sepia', 'dark']) expect(page(tone)!.selector).toContain(':not(.rv-margin)');
  });
});

describe('what is for the screen only', () => {
  it('puts sepia, dark and every remap of a document’s colours in @media screen', () => {
    for (const r of doc) {
      const screenOnly = NAMES_ANOTHER_PAGE.test(r.selector) || /--oa-dk-/.test(r.body) || /--oa-dk-/.test(r.selector);
      if (screenOnly) expect(r.media, r.selector).toBe('@media screen');
    }
  });

  it('keeps the colour as set outside the remap: the remap is always an override of an inline colour', () => {
    const remaps = doc.filter((r) => /--oa-dk-/.test(r.body));
    expect(remaps.length).toBeGreaterThanOrEqual(2);
    for (const r of remaps) {
      expect(r.selector).toContain("[data-page='dark']");
      expect(r.body).toMatch(/!important/);
    }
  });

  it('draws a filter nowhere: a CSS filter would turn pictures and hues over', () => {
    for (const r of doc) expect(r.body, r.selector).not.toMatch(/\bfilter\s*:/);
  });

  it('draws the page white in print, whatever the reader chose', () => {
    // Print is every rule that is not `@media screen`: the white page is the base, and nothing
    // outside the screen block names another page.
    const printed = doc.filter((r) => r.media === null || r.media === '@media print');
    for (const r of printed) expect(r.selector, r.selector).not.toMatch(NAMES_ANOTHER_PAGE);
    const print = doc.find((r) => r.media === '@media print' && r.selector === '.oa-paper');
    expect(decl(print, 'background')).toBe('#fff');
    expect(decl(doc.find((r) => r.media === '@media print' && r.selector === '.oa-doc .ProseMirror'), 'color')).toBe('#000');
    expect(decl(doc.find((r) => r.selector === 'article.oa-paper'), '--page-paper')).toBe('#ffffff');
  });
});
