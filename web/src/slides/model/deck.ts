/**
 * The contract for a Slides deck, written before the editor, the converters or the themes.
 *
 * Two shapes of one deck live here:
 *
 *   · `DeckJSON`, a plain value. What a pptx reader produces and a writer takes, what a template
 *     and a theme are written as, what the assistant will read and write, and what a new deck is made
 *     from. No DOM and no Yjs, so it runs in a Web Worker and in the Worker.
 *   · The **Yjs layout** below, which is what the room holds and the editor changes. The model
 *     (`slides/model/`) converts between the two (`deckToY`, `yToDeck`) and is the only code that
 *     knows the layout.
 *
 * Change this file only additively, and change every side in the same commit.
 *
 * ── Space ───────────────────────────────────────────────────────────────────
 * Every position and size is in **logical pixels on a slide 1920 wide**. The height follows the
 * deck's aspect: 1080 for 16:9, 1440 for 4:3, 1200 for 16:10. The renderer scales the whole slide
 * with one `transform`, so nothing else ever converts.
 *
 *   PowerPoint: 1 px = 6350 EMU on a 16:9 deck (12,192,000 EMU wide). A deck of another width is
 *   scaled to 1920 on import (`scale = 1920 / sldSz.cx`) and back on export.
 *   Type: 1 pt = 2 px (the slide is 13.333 in, 960 pt, wide). Font sizes are stored in **points**,
 *   as PowerPoint and the ribbon show them, and drawn at `pt * 2` px.
 *   Rotation is degrees clockwise, 0 to 360.
 *
 * ── The Yjs layout ──────────────────────────────────────────────────────────
 *
 *   doc.getMap('deck')     v: 1 · size: Aspect · theme: ThemeJSON · master: MasterJSON ·
 *                          layouts: LayoutJSON[]                       (each a plain value: last write wins)
 *   doc.getArray('order')  slide ids, in order                         (Y.Array<string>)
 *   doc.getMap('slides')   id → Y.Map:
 *       layout: string · bg?: Fill · hidden?: boolean · transition?: Transition   (plain values)
 *       notes: Y.XmlFragment                                           (the speaker notes, TextDoc)
 *       z: Y.Array<string>                                             (element ids, back to front)
 *       els: Y.Map<id → Y.Map>                                         (the elements)
 *   an element's Y.Map holds every `ElementJSON` field as its own key, so one person moving an
 *   element and another resizing it both land; `text` is a Y.XmlFragment (TextDoc), a table's
 *   cells are Y.XmlFragments, and a group's children are elements of the same `els` map listed in
 *   the group's own `kids: Y.Array<string>` (back to front) and absent from the slide's `z`.
 *   An element's `id` is the key it is filed under in `els`, and is not stored again in its map.
 *   A table's `rows` are `Y.Array<Y.Map { h, cells: Y.Array<Y.Map { text: Y.XmlFragment, fill?,
 *   rowSpan?, colSpan?, merged?, anchor? }> }>`, so two people typing in two cells both land.
 *
 * A move of a slide or of an element in `z` is a delete and an insert, so two people moving the
 * same one leave it twice. Readers take the **first** occurrence and ignore the rest, and the next
 * step by anyone removes the repeats (as Sheets' `fixRepeats` does). An id in `order` with no entry
 * in `slides`, or in `z` with none in `els`, is skipped, never an error. An element in both `z` and
 * a group's `kids` (one person grouped it while another moved it) is drawn once, where a walk of
 * `z` back to front, entering each group's `kids` where the group is met, first meets it.
 *
 * Every change is one Yjs transaction with a step origin, one undo entry. Undo is a
 * `Y.UndoManager` over `order` and `slides` that tracks only this client's step origins.
 * It covers `deck` too, so a change of theme or layouts is undone with the rest, and it tracks the
 * text editor's origin (`ySyncPluginKey`), so typing and steps on the canvas are one history.
 *
 * ── Text ────────────────────────────────────────────────────────────────────
 * A text body is ProseMirror JSON in the **slide text schema**, which the model defines and the
 * editor, the renderer and the converters share. PowerPoint's model, not Docs': a bullet is a
 * property of a paragraph and not a list node, so a pptx paragraph is one node both ways.
 *
 *   doc        content: paragraph+
 *   paragraph  attrs: align ('left'|'center'|'right'|'justify', default null = inherit),
 *              level (0 to 8), bullet (Bullet | null = inherit, `{ kind: 'none' }` = off),
 *              spaceBefore, spaceAfter (pt, null = inherit), lineHeight (multiple, null = inherit),
 *              indent, bulletIndent (px, as a `TextStyle`'s; null = inherit; set only where a pptx
 *              paragraph states its own margin)
 *              A null or absent level is 0, so a plain paragraph stores no attribute. A lineHeight
 *              multiple is of PowerPoint's single spacing, 1.2 times the font size (`LINE_FACTOR`).
 *   text, hardBreak
 *   marks      bold, italic, underline, strike, link { href }, textStyle { color: Color | null,
 *              fontSize: pt | null, fontFamily: string | null }, highlight { color }, sup, sub
 *
 * What a paragraph or a run does not set comes from, in order: the element's placeholder's style
 * on the layout, the master's text style for that placeholder type and level, the theme.
 */

/** 16:9 is the default and the only aspect a new deck gets. 4:3 and 16:10 come from imports. */
export type Aspect = '16:9' | '4:3' | '16:10';

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT: Record<Aspect, number> = { '16:9': 1080, '4:3': 1440, '16:10': 1200 };

/** One logical px in EMU on a 1920-wide slide of 12,192,000 EMU. */
export const EMU_PER_PX = 6350;
/** Logical px per point of type. */
export const PX_PER_PT = 2;

// ── colour, fill, line ──────────────────────────────────────────────────────

export type ThemeSlot = 'dk1' | 'lt1' | 'dk2' | 'lt2' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6' | 'hlink';

/**
 * `#rrggbb` (lowercase), or a theme slot. `lum` is -1 to 1: negative darkens toward black, positive
 * lightens toward white, as PowerPoint's lumMod/lumOff tints do. `alpha` is 0 to 1.
 */
export type Color = string | { theme: ThemeSlot; lum?: number; alpha?: number };

export type Fill =
  | { kind: 'none' }
  /** `alpha` (0 to 1) fades a `#rrggbb` colour, which has no alpha of its own; a theme colour carries its own. */
  | { kind: 'solid'; color: Color; alpha?: number }
  /** `angle` in degrees, 0 is left to right. Stops at 0 to 1. */
  | { kind: 'gradient'; angle: number; stops: { at: number; color: Color }[] }
  /** An image from the document's assets. `fit` is how it fills the shape. */
  | { kind: 'image'; asset: AssetRef; fit: 'cover' | 'contain' | 'stretch' };

export interface Line {
  color: Color;
  /** px. 0 is no line. */
  width: number;
  dash?: 'solid' | 'dash' | 'dot' | 'dashDot';
  /** Arrow heads, for a line or a connector. */
  head?: 'none' | 'arrow' | 'triangle' | 'oval';
  tail?: 'none' | 'arrow' | 'triangle' | 'oval';
}

/**
 * A picture. `id` is the document's asset id (the assets API), the only kind the room accepts.
 * A converter that has bytes and no asset yet gives `data` (base64) and `mime`; whoever creates
 * the document uploads it and replaces it with an id before the deck reaches a room.
 */
export interface AssetRef {
  id?: string;
  data?: string;
  mime?: string;
}

// ── text ────────────────────────────────────────────────────────────────────

/** ProseMirror JSON in the slide text schema (above). */
export interface TextDoc {
  type: 'doc';
  content: TextNode[];
}
export interface TextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TextNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export type Bullet =
  | { kind: 'none' }
  | { kind: 'char'; char: string; color?: Color }
  /** PowerPoint's autonumber schemes, reduced: `1.`, `1)`, `a.`, `A.`, `i.`, `I.` */
  | { kind: 'number'; style: 'arabicPeriod' | 'arabicParen' | 'alphaLcPeriod' | 'alphaUcPeriod' | 'romanLcPeriod' | 'romanUcPeriod'; start?: number };

/** How a text body sits in its shape. */
export interface TextBox {
  anchor?: 'top' | 'middle' | 'bottom';
  /** px, PowerPoint's default is 0.1 in by 0.05 in: 14.4 and 7.2. */
  insets?: { l: number; t: number; r: number; b: number };
  /** `shrink` scales the type down to fit, `grow` grows the shape, `none` lets it overflow. */
  autofit?: 'none' | 'shrink' | 'grow';
  wrap?: boolean;
  /** Text direction other than horizontal is drawn horizontal. */
  vertical?: boolean;
}

/** A run's and a paragraph's defaults, for one placeholder type at one level. */
export interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: Color;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right' | 'justify';
  bullet?: Bullet;
  /** px from the shape's left inset to the text, and to the bullet. */
  indent?: number;
  bulletIndent?: number;
  /** pt, as a paragraph's own `spaceBefore` and `spaceAfter` are. */
  spaceBefore?: number;
  spaceAfter?: number;
  lineHeight?: number;
}

// ── elements ────────────────────────────────────────────────────────────────

/** PowerPoint's `ph` types that matter here. Anything else imports as `body`. */
export type PlaceholderType = 'title' | 'ctrTitle' | 'subTitle' | 'body' | 'pic' | 'dt' | 'ftr' | 'sldNum';

export interface Placeholder {
  type: PlaceholderType;
  /** Tells two placeholders of one type apart on a layout (two content columns). */
  idx?: number;
}

/**
 * What a slide-number placeholder holds: this text, in one paragraph. A renderer draws the slide's
 * own number in its place, and a pptx writer writes it as a `slidenum` field (`<a:fld>`), as the
 * reader turns such a field into it. The text schema has no field node.
 */
export const SLIDE_NUMBER_TEXT = '‹#›';

interface Base {
  /** Unique in its slide. The model makes one when absent. */
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  flipH?: boolean;
  flipV?: boolean;
  name?: string;
  /** Alt text, read by a screen reader in present mode and written to pptx `descr`. */
  alt?: string;
  /** A placeholder from the layout. Its geometry is the element's own; its text style is inherited. */
  ph?: Placeholder;
  locked?: boolean;
  /** Resizing from the Format pane keeps the shape's proportions (pptx `noChangeAspect`). A picture starts with it on. */
  lockAspect?: boolean;
}

/**
 * The preset geometries the editor draws and pptx carries as `prstGeom`. A text box is a `rect`
 * with no fill and no line. A geometry the reader does not know imports as `rect`, or as a picture
 * when it is a custom path.
 */
export type ShapeKind =
  | 'rect' | 'roundRect' | 'ellipse' | 'triangle' | 'rtTriangle' | 'diamond' | 'parallelogram' | 'trapezoid'
  | 'pentagon' | 'hexagon' | 'octagon' | 'star5' | 'star6' | 'rightArrow' | 'leftArrow' | 'upArrow' | 'downArrow'
  | 'leftRightArrow' | 'chevron' | 'homePlate' | 'plus' | 'heart' | 'cloud' | 'wedgeRectCallout' | 'wedgeRoundRectCallout'
  | 'donut' | 'blockArc' | 'can' | 'cube' | 'bracketPair' | 'bracePair';

export interface ShapeElement extends Base {
  type: 'shape';
  shape: ShapeKind;
  /** roundRect's corner, as a fraction of the shorter side (PowerPoint's `adj`, 0 to 0.5). */
  adjust?: number;
  fill?: Fill;
  line?: Line;
  shadow?: boolean;
  text?: TextDoc;
  textBox?: TextBox;
}

export interface ImageElement extends Base {
  type: 'image';
  asset: AssetRef;
  /** Fractions cut from each side of the source picture, 0 to 1. */
  crop?: { l: number; t: number; r: number; b: number };
  line?: Line;
}

/** A straight line or connector from (x, y) to (x + w, y + h); `flipH`/`flipV` pick the diagonal. */
export interface LineElement extends Base {
  type: 'line';
  line: Line;
}

export interface TableCell {
  text: TextDoc;
  fill?: Fill;
  /** A merge's top-left cell carries the spans; the cells it covers are `{ merged: true }`. */
  rowSpan?: number;
  colSpan?: number;
  merged?: boolean;
  anchor?: 'top' | 'middle' | 'bottom';
}

export interface TableElement extends Base {
  type: 'table';
  /** px, summing to `w`. */
  cols: number[];
  rows: { h: number; cells: TableCell[] }[];
  /** Header row and banded rows, drawn from the theme. */
  firstRow?: boolean;
  bandRows?: boolean;
  border?: Line;
}

/** Children are in slide coordinates, not relative to the group. */
export interface GroupElement extends Base {
  type: 'group';
  children: ElementJSON[];
}

/** A chart, drawn by Sheets' chart renderer from data of its own. */
export interface ChartElement extends Base {
  type: 'chart';
  chart: 'bar' | 'column' | 'line' | 'pie' | 'scatter';
  categories: string[];
  series: { name: string; values: number[]; color?: Color }[];
  title?: string;
}

export type ElementJSON = ShapeElement | ImageElement | LineElement | TableElement | GroupElement | ChartElement;

// ── slides, layouts, master, theme ──────────────────────────────────────────

/**
 * What plays when the show arrives at the slide that carries it (going back, the one being left
 * plays its own the other way round). A slide with none stores no `transition` at all; `kind:
 * 'none'` is what a file may say. The show plays it with transform and opacity only
 * (`slides/present/transitions.ts`), and a viewer asking for reduced motion gets a fade.
 */
export interface Transition {
  kind: 'none' | 'fade' | 'push' | 'wipe' | 'zoom';
  /** ms. 700 when absent; the Duration field keeps it between 100 and 10,000. */
  duration?: number;
  /** For push and wipe: the side the new slide comes from. `right` when absent, as in pptx. */
  from?: 'left' | 'right' | 'top' | 'bottom';
}

export interface SlideJSON {
  id?: string;
  /** A `LayoutJSON.id` in this deck. An unknown one draws as `blank`. */
  layout: string;
  /** Overrides the layout's and the master's background. */
  bg?: Fill;
  hidden?: boolean;
  /** `false` draws neither the master's elements nor the layout's decorations on this slide (pptx `showMasterSp`). */
  showMaster?: boolean;
  transition?: Transition;
  notes?: TextDoc;
  /** Back to front. */
  elements: ElementJSON[];
}

export interface LayoutJSON {
  id: string;
  /** As the Layout menu shows it: "Title and content". */
  name: string;
  bg?: Fill;
  /** `false` draws none of the master's elements on slides with this layout (pptx `showMasterSp`). */
  showMaster?: boolean;
  /**
   * Placeholders (elements with `ph`, usually text-less shapes whose `text` is the prompt, such as
   * "Click to add title"), and decorations drawn on every slide with this layout, behind the
   * slide's own elements. A new slide gets a copy of each placeholder and none of the decorations.
   */
  elements: ElementJSON[];
  /** Placeholder text styles that differ from the master's, by placeholder type. */
  styles?: Partial<Record<PlaceholderType, TextStyle[]>>;
}

export interface MasterJSON {
  bg?: Fill;
  /** Drawn behind every slide's layout decorations. */
  elements: ElementJSON[];
  /**
   * Text styles by kind and level: `title` for title and ctrTitle, `body` for body and subTitle
   * (one entry per level, 0 first), `other` for everything else (a text box, a table cell).
   */
  styles: { title: TextStyle; body: TextStyle[]; other: TextStyle };
}

export interface ThemeJSON {
  id: string;
  name: string;
  colors: Record<ThemeSlot, string> & { folHlink?: string };
  /** Headings and body. Names from docs/core/fonts.ts where possible. */
  fonts: { major: string; minor: string };
}

export interface DeckJSON {
  v: 1;
  size: Aspect;
  theme: ThemeJSON;
  master: MasterJSON;
  layouts: LayoutJSON[];
  slides: SlideJSON[];
}

/**
 * Past these a step is refused with a notice, as a Docs document past its state cap is. The
 * encoded state cap (`LIMITS.docStateMaxBytes`, 3 MiB) applies to a deck as to any document, and
 * pictures are assets, never inline, so it is rarely the one reached.
 */
export const DECK_LIMITS = {
  slides: 500,
  elementsPerSlide: 400,
  groupDepth: 8,
  tableCells: 2500
} as const;
