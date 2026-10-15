import { describe, expect, it } from 'vitest';
import { DECK_LIMITS, SLIDE_HEIGHT, SLIDE_WIDTH, type DeckJSON, type ElementJSON, type LayoutJSON, type ThemeJSON } from '../model/deck';
import { plainText } from './build';
import { blend, contrast, resolveColor, alphaOf } from './color';
import { blankDeck, DEFAULT_THEME_ID, FOOTER_TYPES, LAYOUT_IDS, layoutsFor, masterFor, newSlideElements, SLIDE_NUMBER_TEXT, THEMES } from './index';
import { resolveStyle } from './styles';

const H = SLIDE_HEIGHT['16:9'];
const MARGIN = 154;

const custom = (id: string, accent1: string): ThemeJSON => ({ ...THEMES[0]!, id, name: id, colors: { ...THEMES[0]!.colors, accent1 } });
const ALL = [...THEMES, custom('plain', '#796cbf'), custom('yellow', '#ffe14d')];

const overlaps = (a: ElementJSON, b: ElementJSON): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (outer: ElementJSON, inner: ElementJSON): boolean =>
  outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;

const NAMES: Record<string, string> = {
  title: 'Title slide',
  titleContent: 'Title and content',
  section: 'Section header',
  twoContent: 'Two content',
  comparison: 'Comparison',
  titleOnly: 'Title only',
  blank: 'Blank',
  pictureCaption: 'Picture with caption',
  bigNumber: 'Big number',
  quote: 'Quote'
};

describe('the layouts', () => {
  const layouts = layoutsFor(THEMES[0]!);

  it('are the ten, in the order the Layout menu lists them, named in sentence case', () => {
    expect(layouts.map((l) => l.id)).toEqual(['title', 'titleContent', 'section', 'twoContent', 'comparison', 'titleOnly', 'blank', 'pictureCaption', 'bigNumber', 'quote']);
    expect(layouts.map((l) => l.id)).toEqual([...LAYOUT_IDS]);
    expect(layouts.map((l) => l.name)).toEqual(LAYOUT_IDS.map((id) => NAMES[id]));
    for (const l of layouts) expect(l.name).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
  });

  it('are the same twice', () => {
    expect(JSON.stringify(layoutsFor(THEMES[0]!))).toBe(JSON.stringify(layouts));
  });

  it('prompt in the house voice: short, sentence case, a full stop, no "Click to"', () => {
    for (const l of layouts) {
      for (const el of l.elements) {
        if (!el.ph || el.type !== 'shape') continue;
        const prompt = plainText(el.text);
        expect(prompt.length, `${l.id} ${el.ph.type}`).toBeGreaterThan(0);
        if (el.ph.type === 'sldNum') {
          expect(prompt).toBe(SLIDE_NUMBER_TEXT);
          continue;
        }
        for (const line of prompt.split('\n')) {
          expect(line, `${l.id} ${el.ph.type}`).toMatch(/^Add [a-z ]+\.$/);
          expect(line.length).toBeLessThanOrEqual(24);
        }
      }
    }
  });

  it('use the placeholders PowerPoint does, where it does', () => {
    const types = (id: string) => layouts.find((l) => l.id === id)!.elements.flatMap((e) => (e.ph ? [e.ph.type] : []));
    expect(types('title')).toEqual(expect.arrayContaining(['ctrTitle', 'subTitle']));
    expect(types('titleContent')).toEqual(expect.arrayContaining(['title', 'body']));
    expect(types('twoContent').filter((t) => t === 'body')).toHaveLength(2);
    expect(types('titleOnly')).toContain('title');
    expect(types('pictureCaption')).toEqual(expect.arrayContaining(['title', 'pic', 'body']));
    expect(types('blank').filter((t) => !FOOTER_TYPES.includes(t))).toEqual([]);
  });

  it('carry the date, footer and slide number on every layout', () => {
    for (const l of layouts) {
      const foot = l.elements.filter((e) => e.ph && FOOTER_TYPES.includes(e.ph.type)).map((e) => e.ph!.type);
      expect(foot.sort(), l.id).toEqual(['dt', 'ftr', 'sldNum']);
    }
  });

  it('do not copy their footers or decorations into a new slide, and copy their placeholders without text', () => {
    for (const l of layouts) {
      const copies = newSlideElements(l);
      const want = l.elements.filter((e) => e.ph && !FOOTER_TYPES.includes(e.ph.type));
      expect(copies, l.id).toHaveLength(want.length);
      copies.forEach((c, i) => {
        const src = want[i]!;
        expect(c).toMatchObject({ type: src.type, x: src.x, y: src.y, w: src.w, h: src.h, ph: src.ph });
        expect((c as { text?: unknown }).text, l.id).toBeUndefined();
        expect(c.id).toBe(`e${i + 1}`);
      });
    }
  });
});

describe.each(ALL.map((t) => [t.name, t] as const))('the layouts of %s', (_name, theme) => {
  const master = masterFor(theme);
  const layouts = layoutsFor(theme);
  const deck: DeckJSON = { v: 1, size: '16:9', theme, master, layouts, slides: [] };

  it('keep every element inside the slide, with its ids unique', () => {
    for (const l of layouts) {
      const ids = l.elements.map((e) => e.id);
      expect(new Set(ids).size, `${l.id} ids`).toBe(l.elements.length);
      expect(l.elements.length).toBeLessThanOrEqual(DECK_LIMITS.elementsPerSlide);
      for (const e of l.elements) {
        const at = `${l.id} ${e.name ?? e.id}`;
        expect(e.x, at).toBeGreaterThanOrEqual(0);
        expect(e.y, at).toBeGreaterThanOrEqual(0);
        expect(e.x + e.w, at).toBeLessThanOrEqual(SLIDE_WIDTH);
        expect(e.y + e.h, at).toBeLessThanOrEqual(H);
        expect(e.w, at).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keep text inside the margins, and no two placeholders on top of each other', () => {
    for (const l of layouts) {
      const phs = l.elements.filter((e) => e.ph);
      for (const e of phs) {
        const at = `${l.id} ${e.name ?? e.id}`;
        expect(e.x, at).toBeGreaterThanOrEqual(MARGIN);
        expect(e.x + e.w, at).toBeLessThanOrEqual(SLIDE_WIDTH - MARGIN);
        expect(e.y, at).toBeGreaterThanOrEqual(96);
        expect(e.y + e.h, at).toBeLessThanOrEqual(H - 56);
      }
      for (let i = 0; i < phs.length; i++) {
        for (let j = i + 1; j < phs.length; j++) {
          expect(overlaps(phs[i]!, phs[j]!), `${l.id}: ${phs[i]!.name} over ${phs[j]!.name}`).toBe(false);
        }
      }
    }
  });

  it('give a placeholder a unique type and idx within its layout', () => {
    for (const l of layouts) {
      const keys = l.elements.filter((e) => e.ph).map((e) => `${e.ph!.type}:${e.ph!.idx ?? ''}`);
      expect(new Set(keys).size, l.id).toBe(keys.length);
    }
  });

  /** The colour behind a layout element: a shape under it that holds it, else its own fill, else the layout's ground, else the master's. */
  function groundBehind(layout: LayoutJSON, index: number): string {
    const el = layout.elements[index]!;
    const own = el.type === 'shape' && el.fill?.kind === 'solid' ? el.fill.color : null;
    let ground = resolveColor(own ?? '#000000', theme);
    if (own) return ground;
    const bg = layout.bg ?? master.bg;
    ground = bg?.kind === 'solid' ? resolveColor(bg.color, theme) : '#ffffff';
    layout.elements.slice(0, index).forEach((under) => {
      if (!under.ph && under.type === 'shape' && under.fill?.kind === 'solid' && contains(under, el)) {
        ground = blend(resolveColor(under.fill.color, theme), alphaOf(under.fill.color), ground);
      }
    });
    return ground;
  }

  it('read: titles 3 to 1 on what is behind them, every other text 4.5 to 1, at every level', () => {
    for (const l of layouts) {
      l.elements.forEach((el, index) => {
        if (!el.ph) return;
        const ground = groundBehind(l, index);
        const levels = el.ph.type === 'body' || el.ph.type === 'subTitle' ? [0, 1, 2, 3, 4] : [0];
        for (const level of levels) {
          const style = resolveStyle(master, l, el.ph.type, level);
          const isTitle = el.ph.type === 'title' || el.ph.type === 'ctrTitle';
          const at = `${l.id} ${el.name} level ${level}`;
          expect(contrast(resolveColor(style.color ?? '#000000', theme), ground), at).toBeGreaterThanOrEqual(isTitle ? 3 : 4.5);
          if (style.bullet?.kind === 'char') {
            expect(contrast(resolveColor(style.bullet.color ?? style.color ?? '#000000', theme), ground), `${at} bullet`).toBeGreaterThanOrEqual(3);
          }
        }
      });
    }
  });

  it('draw the title and section slides on a colour, and the rest on the master’s ground', () => {
    const byId = new Map(layouts.map((l) => [l.id, l]));
    for (const id of ['title', 'section']) expect(byId.get(id)!.bg?.kind, id).toBe('solid');
    for (const l of layouts) if (l.id !== 'title' && l.id !== 'section') expect(l.bg, l.id).toBeUndefined();
    expect(deck.layouts).toHaveLength(10);
  });

  it('size the title slide’s title bigger than the master’s, and the section’s the same', () => {
    const title = layouts.find((l) => l.id === 'title')!.styles!.ctrTitle![0]!.fontSize!;
    const section = layouts.find((l) => l.id === 'section')!.styles!.title![0]!.fontSize!;
    expect(title).toBeGreaterThan(master.styles.title.fontSize!);
    expect(section).toBe(title);
  });

  it('set a figure large over its caption on the big number layout', () => {
    const l = layouts.find((x) => x.id === 'bigNumber')!;
    const [figure, caption] = l.styles!.subTitle!;
    expect(figure!.fontSize!).toBeGreaterThanOrEqual(72);
    expect(caption!.fontSize!).toBeLessThan(figure!.fontSize!);
    // The card holds both, and is a decoration: a new slide does not copy it.
    const card = l.elements.find((e) => e.name === 'Card')!;
    const ph = l.elements.find((e) => e.ph?.type === 'subTitle')!;
    expect(card.ph).toBeUndefined();
    expect(contains(card, ph)).toBe(true);
  });
});

describe('blankDeck', () => {
  it('is a 16:9 deck in the default theme, with its master and layouts and one empty title slide', () => {
    const deck = blankDeck();
    expect(deck.v).toBe(1);
    expect(deck.size).toBe('16:9');
    expect(deck.theme.id).toBe(DEFAULT_THEME_ID);
    expect(deck.master).toEqual(masterFor(deck.theme));
    expect(deck.layouts).toEqual(layoutsFor(deck.theme));
    expect(deck.slides).toHaveLength(1);
    const [slide] = deck.slides;
    expect(slide!.layout).toBe('title');
    expect(slide!.elements.map((e) => e.ph?.type)).toEqual(['ctrTitle', 'subTitle']);
    for (const e of slide!.elements) expect((e as { text?: unknown }).text).toBeUndefined();
  });

  it('takes a theme by id, and falls back to the default for one nobody has', () => {
    for (const t of THEMES) expect(blankDeck(t.id).theme).toBe(t);
    expect(blankDeck('nope').theme.id).toBe(DEFAULT_THEME_ID);
  });

  it('is the same JSON every time, so a new document is not different from the last', () => {
    for (const t of THEMES) expect(JSON.stringify(blankDeck(t.id))).toBe(JSON.stringify(blankDeck(t.id)));
    const a = blankDeck();
    const b = blankDeck();
    expect(a).not.toBe(b);
    expect(a.slides[0]).not.toBe(b.slides[0]);
  });

  it('holds no undefined, which a Yjs map would refuse', () => {
    const walk = (v: unknown, path: string): void => {
      if (v === undefined) throw new Error(`undefined at ${path}`);
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    for (const t of THEMES) walk(blankDeck(t.id), t.id);
  });
});
