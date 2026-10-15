/**
 * A theme's ten layouts.
 *
 * Geometry is the Slides board's, on a 1920 by 1080 slide: a margin of 8% (154 px) either side,
 * a title from 100 down, content from 368 to 928, and a footer line at 972. It is the same in
 * every theme; what a theme changes is colour, type and the ground the title and section slides
 * draw on (`themes.ts`).
 *
 * A placeholder is a shape with a `ph` whose `text` is the prompt an empty one shows. Footer, date
 * and slide number are on every layout, as PowerPoint has them, and **a new slide does not copy
 * them**: it copies the title and content placeholders, and a footer is something a person turns
 * on. The slide number's text is `SLIDE_NUMBER_TEXT`, which the renderer and the pptx writer read
 * as the number (the writer as `<a:fld type="slidenum">`).
 *
 * Where a layout needs a placeholder to read differently from the master's (a caption without a
 * bullet, a heading in bold), it says so in `styles`, which is by placeholder type and level. The
 * comparison's headings are `subTitle` placeholders for that reason, and a figure and its caption
 * are one `subTitle` placeholder whose first level is the figure and whose second is the caption.
 */

import type { Box } from './build';
import { doc, FLUSH, para, placeholder, rule, shape, withIds } from './build';
import { SLIDE_NUMBER_TEXT, type Color, type ElementJSON, type LayoutJSON, type TextBox, type TextStyle, type ThemeJSON } from '../model/deck';
import { NO_BULLET } from './master';
import { lookOf, tonesOf } from './themes';

export { SLIDE_NUMBER_TEXT };

/** The ids, in the order the Layout menu lists them. */
export const LAYOUT_IDS = ['title', 'titleContent', 'section', 'twoContent', 'comparison', 'titleOnly', 'blank', 'pictureCaption', 'bigNumber', 'quote'] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];

/** Placeholder types a new slide does not copy from its layout. */
export const FOOTER_TYPES: readonly string[] = ['dt', 'ftr', 'sldNum'];

const MARGIN = 154;
const FULL = 1920 - 2 * MARGIN;
const COLUMN = 776;
const SECOND = 1920 - MARGIN - COLUMN;

const TITLE: Box = { x: MARGIN, y: 100, w: FULL, h: 240 };
const CONTENT: Box = { x: MARGIN, y: 368, w: FULL, h: 560 };
const LEFT: Box = { ...CONTENT, w: COLUMN };
const RIGHT: Box = { ...CONTENT, x: SECOND, w: COLUMN };

const FOOT = 972;
const FOOTER: Box = { x: MARGIN, y: FOOT, w: 900, h: 44 };
const DATE: Box = { x: 1100, y: FOOT, w: 400, h: 44 };
const NUMBER: Box = { x: 1566, y: FOOT, w: 200, h: 44 };

const BOTTOM: TextBox = { ...FLUSH, anchor: 'bottom' };
const CENTRED: TextBox = { anchor: 'middle', insets: { l: 24, t: 24, r: 24, b: 24 }, autofit: 'shrink', wrap: true };
const FOOTER_BOX: TextBox = { anchor: 'middle', insets: { l: 0, t: 0, r: 0, b: 0 }, autofit: 'none', wrap: true };

/** Prose in a placeholder that would otherwise be a list. */
const prose = (fontSize: number, color: Color, extra: TextStyle = {}): TextStyle => ({ fontSize, color, ...NO_BULLET, spaceBefore: 0, ...extra });

/**
 * A style for all five levels, for a placeholder that sits on a colour: the master's levels are ink
 * for its own ground, and a paragraph one level in would otherwise fall back to them.
 */
const allLevels = (...styles: TextStyle[]): TextStyle[] => Array.from({ length: 5 }, (_, level) => styles[Math.min(level, styles.length - 1)]!);

interface Tones {
  ground: Color;
  ink: Color;
  muted: Color;
  /** The colour of a decoration: a rule, a band. */
  accent: Color;
}

/** The footer line: date, footer and slide number, in the quiet ink of the ground they sit on. */
function footers(muted: Color): { elements: ElementJSON[]; styles: NonNullable<LayoutJSON['styles']> } {
  const small = (align: 'left' | 'right'): TextStyle => ({ fontSize: 12, color: muted, align, ...NO_BULLET, spaceBefore: 0, lineHeight: 1 });
  return {
    elements: [
      placeholder({ type: 'dt', idx: 10 }, DATE, 'Add a date.', { name: 'Date', textBox: FOOTER_BOX }),
      placeholder({ type: 'ftr', idx: 11 }, FOOTER, 'Add a footer.', { name: 'Footer', textBox: FOOTER_BOX }),
      placeholder({ type: 'sldNum', idx: 12 }, NUMBER, SLIDE_NUMBER_TEXT, { name: 'Slide number', textBox: FOOTER_BOX })
    ],
    styles: { dt: [small('right')], ftr: [small('left')], sldNum: [small('right')] }
  };
}

export function layoutsFor(theme: ThemeJSON): LayoutJSON[] {
  const look = lookOf(theme);
  const base = tonesOf(theme);
  const normal: Tones = { ground: base.ground, ink: base.ink, muted: base.muted, accent: base.accent };
  const hero: Tones = { ground: look.hero.bg, ink: look.hero.ink, muted: look.hero.muted, accent: look.hero.accent };
  const tint: Tones = { ground: base.surface, ink: base.ink, muted: base.muted, accent: base.accent };

  const titlePh = (box: Box = TITLE, text = 'Add a title.') =>
    placeholder({ type: 'title' }, box, text, { name: 'Title', textBox: FLUSH });
  const bodyPh = (idx: number, box: Box, name = 'Content', text = 'Add your points.', textBox: TextBox = FLUSH) =>
    placeholder({ type: 'body', idx }, box, text, { name, textBox });

  /** A layout, with its footer line in the quiet ink of `on`. Ids are numbered in order. */
  const layout = (
    id: LayoutId,
    name: string,
    on: Tones,
    parts: ElementJSON[],
    styles: NonNullable<LayoutJSON['styles']> = {},
    ground?: Color
  ): LayoutJSON => {
    const foot = footers(on.muted);
    return {
      id,
      name,
      ...(ground ? { bg: { kind: 'solid', color: ground } } : {}),
      elements: withIds([...parts, ...foot.elements]),
      styles: { ...styles, ...foot.styles }
    };
  };

  // ── on the hero ground: the title slide ─────────────────────────────────

  const titleSlide = layout(
    'title',
    'Title slide',
    hero,
    [
      placeholder({ type: 'ctrTitle' }, { x: MARGIN, y: 270, w: 1400, h: 340 }, 'Add a title.', { name: 'Title', textBox: BOTTOM }),
      shape('rect', { x: MARGIN, y: 646, w: 120, h: 12 }, hero.accent, { name: 'Accent', alt: '' }),
      placeholder({ type: 'subTitle', idx: 1 }, { x: MARGIN, y: 704, w: 1300, h: 160 }, 'Add a subtitle.', { name: 'Subtitle', textBox: FLUSH })
    ],
    {
      ctrTitle: [{ fontSize: look.cover, color: hero.ink }],
      subTitle: allLevels(prose(28, hero.muted))
    },
    hero.ground
  );

  // ── on a tint: the section header ───────────────────────────────────────

  const sectionHeader = layout(
    'section',
    'Section header',
    tint,
    [
      shape('rect', { x: 0, y: 0, w: 48, h: 1080 }, tint.accent, { name: 'Band', alt: '' }),
      placeholder({ type: 'title' }, { x: MARGIN, y: 340, w: 1400, h: 260 }, 'Add a title.', { name: 'Title', textBox: BOTTOM }),
      bodyPh(1, { x: MARGIN, y: 640, w: 1200, h: 160 }, 'Text', 'Add a short intro.')
    ],
    {
      title: [{ fontSize: look.cover, color: tint.ink }],
      body: allLevels(prose(28, tint.muted))
    },
    tint.ground
  );

  // ── on the ground ───────────────────────────────────────────────────────

  const titleAndContent = layout('titleContent', 'Title and content', normal, [titlePh(), bodyPh(1, CONTENT)]);

  const twoContent = layout('twoContent', 'Two content', normal, [titlePh(), bodyPh(1, LEFT, 'Left content'), bodyPh(2, RIGHT, 'Right content')]);

  const heading = (idx: number, box: Box, name: string) =>
    placeholder({ type: 'subTitle', idx }, box, 'Add a heading.', { name, textBox: { ...FLUSH, anchor: 'bottom' } });
  const comparison = layout(
    'comparison',
    'Comparison',
    normal,
    [
      titlePh(),
      heading(1, { x: MARGIN, y: 368, w: COLUMN, h: 72 }, 'Left heading'),
      rule(MARGIN, 456, COLUMN, normal.accent, 3, 'Left rule'),
      bodyPh(2, { ...LEFT, y: 480, h: 448 }, 'Left content'),
      heading(3, { x: SECOND, y: 368, w: COLUMN, h: 72 }, 'Right heading'),
      rule(SECOND, 456, COLUMN, normal.accent, 3, 'Right rule'),
      bodyPh(4, { ...RIGHT, y: 480, h: 448 }, 'Right content')
    ],
    { subTitle: [prose(28, normal.ink, { bold: true })] }
  );

  const titleOnly = layout('titleOnly', 'Title only', normal, [titlePh()]);

  const blank = layout('blank', 'Blank', normal, []);

  const pictureCaption = layout(
    'pictureCaption',
    'Picture with caption',
    normal,
    [
      titlePh({ x: MARGIN, y: 112, w: 700, h: 280 }),
      placeholder({ type: 'pic', idx: 1 }, { x: 934, y: 112, w: COLUMN + 56, h: 816 }, 'Add a picture.', {
        name: 'Picture',
        textBox: CENTRED,
        fill: { kind: 'solid', color: tint.ground }
      }),
      bodyPh(2, { x: MARGIN, y: 440, w: 700, h: 488 }, 'Caption', 'Add a caption.')
    ],
    {
      body: [prose(24, normal.muted)],
      pic: [prose(20, normal.muted, { align: 'center' })]
    }
  );

  // The card is the render's: bullets at the left, a figure on a card at the right.
  const card = look.card;
  const bigNumber = layout(
    'bigNumber',
    'Big number',
    normal,
    [
      titlePh(),
      bodyPh(1, { x: MARGIN, y: 368, w: 922, h: 560 }, 'Content'),
      shape('roundRect', { x: 1228, y: 368, w: 538, h: 560 }, card.bg, { name: 'Card', adjust: 0.06, alt: '' }),
      placeholder(
        { type: 'subTitle', idx: 2 },
        { x: 1272, y: 412, w: 450, h: 472 },
        doc(para('Add a figure.'), para('Add a caption.', { level: 1 })),
        { name: 'Figure', textBox: BOTTOM }
      )
    ],
    {
      subTitle: allLevels(
        prose(80, card.ink, { bold: true, fontFamily: theme.fonts.major, lineHeight: 0.85, spaceAfter: 6 }),
        prose(22, card.ink, { bold: false, fontFamily: theme.fonts.minor, lineHeight: 1 })
      )
    }
  );

  const quote = layout(
    'quote',
    'Quote',
    normal,
    [
      shape('rect', { x: MARGIN, y: 280, w: 10, h: 520 }, normal.accent, { name: 'Rule', alt: '' }),
      bodyPh(1, { x: 214, y: 280, w: 1450, h: 400 }, 'Quote', 'Add a quote.', BOTTOM),
      placeholder({ type: 'subTitle', idx: 2 }, { x: 214, y: 712, w: 1450, h: 88 }, 'Add who said it.', { name: 'Attribution', textBox: FLUSH })
    ],
    {
      body: [prose(44, normal.ink, { fontFamily: theme.fonts.major, lineHeight: 1.05 })],
      subTitle: [prose(24, normal.muted)]
    }
  );

  return [titleSlide, titleAndContent, sectionHeader, twoContent, comparison, titleOnly, blank, pictureCaption, bigNumber, quote];
}
