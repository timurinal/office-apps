import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast } from './core/color';

/**
 * The colours the themes assign, read from the stylesheets and held to what text needs. A role set
 * that is wrong is a label nobody can read in one of the two themes, and the stylesheet is where
 * that gets decided, so it is read from there rather than copied here.
 */

const read = (p: string) => readFileSync(join(process.cwd(), 'web', p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector (whitespace squeezed) contains `needle`. */
function block(css: string, needle: string): Record<string, string> {
  const squeezed = css.replace(/\s+/g, ' ');
  const at = squeezed.indexOf(needle);
  if (at < 0) throw new Error(`no rule for ${needle}`);
  const open = squeezed.indexOf('{', at);
  const close = squeezed.indexOf('}', open);
  const out: Record<string, string> = {};
  for (const m of squeezed.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const styles = read('src/styles.css');
const doc = read('src/docs/doc.css');

/** The dark glass the ribbon and the panes are, over a dark desk. */
const GLASS = '#1f2131';
const PAPER = '#232532';

describe('the app colours on a dark ground', () => {
  for (const app of ['docs', 'sheets']) {
    const set = block(styles, `[data-theme='dark'] [data-app='${app}'],`);
    it(`${app}: the ink on a solid, and the link, read`, () => {
      expect(contrast(set['--app-on-solid']!, set['--app-solid']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(set['--app-text']!, GLASS)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(set['--app-700']!, PAPER)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${app}: a glyph in the app's colour holds 3:1 on the paper`, () => {
      expect(contrast(set['--app-600']!, PAPER)).toBeGreaterThanOrEqual(3);
    });
  }

  it('violet: the same', () => {
    const set = block(styles, "html[data-theme='dark'],");
    expect(contrast(set['--app-on-solid']!, '#b5abfc')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#d2cefd', GLASS)).toBeGreaterThanOrEqual(4.5);
  });

  it("danger as text reads on the dark theme's raised surface and its paper", () => {
    const ink = block(styles, "[data-theme='dark'] { --fg-1")['--danger-ink']!;
    expect(contrast(ink, '#2b2d3c')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, PAPER)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Slides' chrome on Light", () => {
  const set = block(styles, "[data-app='slides'][data-theme='light']");
  it('puts white on the solid, and the link on white, at 4.5:1', () => {
    expect(contrast(set['--app-on-solid']!, set['--app-solid']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(set['--app-text']!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Slides' ramp on a dark ground", () => {
  // Slides' own block keeps the light ramp's 50, 200, 600 and 700, and the shared parts wash a chosen
  // or hovered control in the 50: a light chip under light text in the dark chrome (the Share dialog's
  // chosen access, the open role list's button) and on dark Home. Under a dark theme they take the
  // pattern the other apps' dark ramps follow.
  const set = block(styles, "[data-theme='dark'] [data-app='slides'],");
  const ramp = block(styles, "[data-app='slides'] {");
  it('the 50 and the 200 are tints of the 300, and the 600 and 700 step up to the 400 and 300', () => {
    expect(set['--app-50']).toBe('rgba(249, 168, 116, 0.14)');
    expect(set['--app-200']).toBe('rgba(249, 168, 116, 0.26)');
    expect(set['--app-600']).toBe(ramp['--app-400']);
    expect(set['--app-700']).toBe(ramp['--app-300']);
  });
  it('a glyph holds 3:1 and a label 4.5:1 on the paper', () => {
    expect(contrast(set['--app-600']!, PAPER)).toBeGreaterThanOrEqual(3);
    expect(contrast(set['--app-700']!, PAPER)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the pages', () => {
  const PAGES: [string, string][] = [
    ['white', 'article.oa-paper > :not(.rv-margin) {'],
    ['sepia', "article.oa-paper[data-page='sepia'] > :not(.rv-margin) {"],
    ['dark', "article.oa-paper[data-page='dark'] > :not(.rv-margin) {"]
  ];
  for (const [tone, selector] of PAGES) {
    const set = block(doc, selector);
    it(`${tone}: body text, headings, quotes and links read at 4.5:1`, () => {
      for (const t of ['--fg-1', '--fg-2', '--fg-3', '--fg-4', '--doc-link', '--doc-link-hover', '--doc-mention-fg']) {
        const against = t === '--doc-mention-fg' && tone !== 'sepia' ? mix(set[t]!, set['--doc-mention-bg']!, set['--paper']!) : set['--paper']!;
        // --fg-4 is the design system's quiet text (slate 600, 4.3:1 on white); the rest is body text.
        expect(contrast(set[t]!, against), `${tone} ${t} ${set[t]}`).toBeGreaterThanOrEqual(t === '--fg-4' ? 4.3 : 4.5);
      }
    });
  }

  /** The ground a translucent pill sits on, so its text is measured on what is really behind it. */
  function mix(_fg: string, bg: string, paper: string): string {
    const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(bg);
    if (!m) return bg.startsWith('#') ? bg : paper;
    const a = Number(m[4]);
    const p = parseInt(paper.slice(1), 16);
    const ch = (s: number, v: number) => Math.round(v * a + ((p >> s) & 255) * (1 - a));
    return '#' + [ch(16, +m[1]!), ch(8, +m[2]!), ch(0, +m[3]!)].map((n) => n.toString(16).padStart(2, '0')).join('');
  }
});
