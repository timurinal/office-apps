/**
 * What a Slides module is, and what it is handed.
 *
 * Slides is one shell and a list of modules (web/src/slides/modules/index.ts), the way Docs and
 * Sheets are. A module is a file that exports a `SlidesModule`: the ribbon groups it adds to a tab,
 * the commands the Ctrl+K box can run, the keys it takes, and optionally panes, footer items, File
 * rows, editing modes, overlays, things drawn over the slide, a snap rule, a view and the slide
 * show. It is added by listing it in the index and nothing else changes, so the Design tab, the
 * Format pane, the slide sorter and the slide show are built without touching `core.tsx`.
 *
 * Everything a module's predicates and commands see is a `SlidesContext`. Read what you need from
 * it and never reach past it: `ctx.can` already says what this person may do on this source, and
 * `ctx.model` is the one way to change the deck, each call one undoable step (model/model.ts).
 * Gate on `ctx.can`, never on a role or a source kind.
 *
 * ── The ribbon ──────────────────────────────────────────────────────────────
 * Groups are placed by `tab` and `order` (lower is further left). Core uses round numbers so a
 * module can slot in between with 150. Core fills the slots marked *; the rest are reserved for
 * the module named, and a tab with no visible group is not drawn, so a tab appears when its first
 * group does.
 *
 *   home         History 100* · Clipboard 150* · Slides 200* (New slide, Layout, Reset) ·
 *                Font 300* · Paragraph 400* · Drawing 500 (shapes, arrange, quick styles) ·
 *                Editing 600 (find, select)
 *   insert       Slides 100* (New slide) · Tables 200 · Images 300 · Illustrations 400 (shapes,
 *                charts) · Text 500* (Text box) · Links 600
 *   design       Themes 100 · Variants 200 · Customise 300 (slide size, background)
 *   transitions  Preview 100 · Transition 200 · Timing 300
 *   slideshow    Start 100* (From beginning, From current slide: drawn only when a module has a
 *                `presenter`) · Set up 200* (Hide slide)
 *   review       Proofing 100. Comments are not built for Slides.
 *   view         Views 100* (Normal, and each module's `views`) · Show 200* (Notes) · Zoom 300*
 *   help         whatever a help module wants
 *
 * ── The File menu ───────────────────────────────────────────────────────────
 * Rows come in sections, each placed by the `order` of its first row. Core's:
 *
 *   Document   New 100 · Open 200 · Make a copy 300 · Rename 400
 *   Share      Version history 500 · Share 510
 *   Export     reserved, 600 to 690: Export as PowerPoint goes at 610, PDF at 620
 *   Danger     Move to trash 900
 *
 * Commands take their `section` from the same vocabulary: File, Edit, Insert, Format, Slide, View.
 *
 * ── The footer ──────────────────────────────────────────────────────────────
 * Left: "Slide 2 of 6" 10*, the connection 20*. Right, before the shell's zoom: Notes 10*, the
 * view switches 20*, Fit 30*. A module's item takes a free order between them.
 *
 * ── Panes ───────────────────────────────────────────────────────────────────
 * `PaneSpec`s on either edge. The right edge has two by convention: Version history (core,
 * `history`, 360 wide) and the **Format pane** (`format`, 272 wide), which the format module
 * contributes and anything opens with `ctx.panes.open('format')`. One pane per edge is open at a
 * time; opening another replaces it.
 *
 * ── The canvas ──────────────────────────────────────────────────────────────
 * The slide is drawn at `scale` screen px per slide px (a slide is 1920 wide, model/deck.ts).
 *
 *   canvas    `CanvasLayer`s are drawn over the slide, under the selection's handles, in a box
 *             the size of the slide on screen. Smart guides, a crop frame and a table's cell
 *             outline go here. Each is told the drag in progress, if any.
 *   snap      During a move or a resize, every module's `snap` is asked, in order, where the box
 *             being dragged would rather be. The first answer that is not null wins: its `dx`
 *             and `dy` (slide px) are added to the drag, and its `guides` are drawn as dashed
 *             lines in the app's guide colour until the drag ends. A resize applies `dx` and `dy`
 *             to the edges the handle moves, not to the box's origin. Snapping is off while Alt
 *             is held, as PowerPoint's is.
 *
 * ── Views ───────────────────────────────────────────────────────────────────
 * Normal (the rail, the slide and the notes) is core's and always first. A module's `views` add
 * more, drawn in place of Normal's area and listed in the View tab and the footer: the slide sorter
 * is one. `ctx.view` is the id on screen and `ctx.setView` changes it.
 *
 * ── The right-click menu ────────────────────────────────────────────────────
 * A module's `contextItems(target, ctx)` answers with groups of rows (`ContextGroup`: an `order` and
 * the entries); the editor joins every module's groups by `order` with a rule between, and the menu
 * (core/ContextMenu.tsx) draws them. `target` is what was clicked (`SlidesMenuTarget`); whoever heard
 * the click (the canvas layer, the rail, the sorter) asks for the menu with `ctx.contextMenu`, and when
 * no module has a row for it the browser's own menu is left alone. Core's (modules/menus.tsx) fills the
 * slots marked *; a module adds a group between with a number between.
 *
 *   shape    Clipboard 100* (Cut, Copy, Paste) · Text 200* (Edit text, Link, Alt text) · Arrange 300*
 *            (Group, Ungroup, Arrange ▸) · Format 400* (Format shape) · Table 450* (a table's rows and
 *            columns, merge and split) · Object 500* (Duplicate, Delete)
 *   canvas   Clipboard 100* (Paste) · Slide 200* (Layout ▸, Format background)
 *   slides   New 100* (New slide) · Edit 200* (Duplicate, Delete) · Slide 300* (Hide or Show, Layout ▸)
 *
 * Over text being typed in, and with Shift held, the browser's menu is the person's. A reader's menu has
 * no row that changes the deck (a shape's is Copy where downloads are on).
 *
 * ── The slide show ──────────────────────────────────────────────────────────
 * `ctx.present(fromSlideIndex)` starts it. One module provides a `presenter`; its `render` is
 * drawn over the whole page while a show runs and calls `close` to end it. With no presenter the
 * Present button, the Slide show tab's Start group and F5 are not there, and `present` does
 * nothing.
 */

import type { ReactNode } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { DocKind, DocumentMeta } from '@shared/api';
import type { Caps } from '../../core/caps';
import type { ContextHook, Point } from '../../core/ContextMenu';
import type { PhIcon } from '../../core/icons';
import type { Command, EditingMode, FileItem, PaneSpec, RibbonGroup, StatusItem, TabDef } from '../../core/shell/types';
import type { Toast } from '../../core/ui';
import type { DocumentSource, SourceFeatures } from '../../docs/source';
import type { Aspect, SlideJSON } from '../model/deck';
import type { Box, SlideModel } from '../model/model';
import type { Design } from '../model/styles';
import type { Handle } from '../editor/geometry';
import type { Selection, SelectionStore } from '../editor/selection';
import type { TextFormat } from '../editor/format';

/** The ribbon's tabs for Slides, in order. A tab with no group on it is not drawn. */
export const SLIDES_TABS: readonly TabDef[] = [
  { id: 'file', label: 'File' },
  { id: 'home', label: 'Home' },
  { id: 'insert', label: 'Insert' },
  { id: 'design', label: 'Design' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'slideshow', label: 'Slide show' },
  { id: 'review', label: 'Review' },
  { id: 'view', label: 'View' },
  { id: 'help', label: 'Help' }
];

/** What this person may do here, source and role together. */
export interface SlidesCan {
  /** Change the deck. False in the trash, as a reader, in Viewing mode, in a version preview, after the room stopped. */
  edit: boolean;
  share: boolean;
  history: boolean;
  copy: boolean;
  trash: boolean;
  star: boolean;
  rename: boolean;
  /** Make another document: a cloud source only. */
  create: boolean;
  /** Download, print or copy out: false for a reader on a link whose owner turned downloads off. */
  download: boolean;
  /** Start the slide show: true when a module provides one. */
  present: boolean;
  /** Offer the deck as a template, or take it back: its owner, on a cloud source, out of the trash. */
  template: boolean;
}

export interface PaneApi {
  isOpen: (id: string) => boolean;
  open: (id: string) => void;
  close: (id: string) => void;
  toggle: (id: string) => void;
}

/** Things a command can do to the document as a whole. Each is a no-op where it does not apply. */
export interface SlidesActions {
  /** `from` is the button, so the dialog can grow out of it. */
  share: (from?: HTMLElement | null) => void;
  copy: () => void;
  trash: () => void;
  newDocument: (kind?: DocKind) => void;
  openHome: () => void;
  /** Put the caret in the title so it can be typed over. */
  focusTitle: () => void;
  /** Put the keyboard back on the slide, after a menu or a dialog. */
  focusCanvas: () => void;
  /** Put the keyboard on the slide list. */
  focusRail: () => void;
  /** Put the keyboard in the command box. */
  focusPalette: () => void;
}

/** How the page is connected, for the footer. */
export type Connection = 'live' | 'connecting' | 'offline' | 'local' | 'stopped';

/** Changing what is selected. Every call replaces the canvas's text caret, if there was one. */
export interface SelectApi {
  /** Show a slide on the canvas. `extend` is the rail's Shift (a range) or Ctrl (one more or one fewer). */
  slide: (id: string, extend?: 'range' | 'toggle') => void;
  /** Choose elements on the slide on the canvas. */
  elements: (ids: readonly string[]) => void;
  /** Put the caret in a shape's text: `all` selects the whole text, as typing over a selected shape does. */
  editText: (elId: string, at?: 'end' | 'all') => void;
  /** Nothing chosen on the canvas, and no caret. */
  clear: () => void;
}

export interface SlidesContext {
  /**
   * The deck on screen: the live one, or a version being previewed. Every change goes through it;
   * it refuses them itself (with a notice) where `can.edit` is false.
   */
  model: SlideModel;
  source: DocumentSource;
  features: SourceFeatures;
  meta: DocumentMeta;
  caps: Caps;
  can: SlidesCan;
  connection: Connection;
  /** The room, for other people's carets in a table cell: null on a local file and in a version. */
  awareness: Awareness | null;
  /** The theme, master, layouts and size, as this render read them. `model.design()` is always current. */
  design: Design & { size: Aspect };
  /** The slide on the canvas: null in a deck with no slides. */
  slideId: string | null;
  /** Its place in the deck, from 0; -1 with none. */
  slideIndex: number;
  /** What is chosen, as this render read it. Read `selection.get()` inside a command for the value now. */
  selected: Selection;
  /** The selection itself, for a command that runs later and a component that follows it. */
  selection: SelectionStore;
  select: SelectApi;
  /** Character and paragraph formatting of the text being typed in, or of the whole text of the chosen shapes. */
  text: TextFormat;
  /** The editing mode's id: `editing`, `viewing`, and whatever a module adds. */
  mode: string;
  setMode: (id: string) => void;
  /** The zoom as a percentage of a 1280 px slide, whatever `fit` gives. */
  zoom: number;
  /** The slide fills the room it has, and follows the window. */
  fit: boolean;
  setZoom: (percent: number | 'fit') => void;
  /** The view on screen: `normal`, or a module's. */
  view: string;
  setView: (id: string) => void;
  /** Every view, Normal first: what the View tab and the footer offer. */
  views: readonly { id: string; label: string; icon?: PhIcon }[];
  /** The speaker notes under the slide. */
  notes: { shown: boolean; setShown: (on: boolean) => void };
  panes: PaneApi;
  actions: SlidesActions;
  /** Start the slide show at a slide, from 0. Nothing happens without a presenter. */
  present: (fromSlideIndex: number) => void;
  /**
   * Open the right-click menu for what was clicked, at a point in window pixels. `from` is the element
   * whose colours it wears. False, and nothing drawn, when no module has a row for the target.
   */
  contextMenu: (target: SlidesMenuTarget, at: Point, from?: Element | null) => boolean;
  notify: (toast: Toast) => void;
}

/**
 * What a right click landed on: the chosen objects on the slide (their top-level ids; the chosen
 * cells of a table are the tables module's), the slide's own ground, or slides in the rail or the sorter.
 */
export type SlidesMenuTarget = { kind: 'shape'; ids: readonly string[] } | { kind: 'canvas' } | { kind: 'slides'; ids: readonly string[] };

/** A key a module takes while the slide or the slide list has the keyboard (never in a text box or a field). */
export interface SlidesKey {
  /**
   * `Mod+Z`, `Mod+Shift+Z`, `Mod+M`, `F5`, `Shift+F5`: `Mod` is Ctrl, or Cmd on a Mac, and a letter
   * matches either case.
   */
  keys: string;
  /** Return false when the key was not used after all; otherwise the browser's own action is prevented. */
  run: (c: SlidesContext) => boolean | void;
  /** The key is skipped when this says no, and goes on to the browser. */
  when?: (c: SlidesContext) => boolean;
}

/** Something drawn over the whole editor: a dialog, a menu. It has no slot in a ribbon. */
export interface SlidesOverlay {
  id: string;
  /** Rendered once, inside the shell, so it takes the app's colours. It decides for itself when to show anything. */
  render: (c: SlidesContext) => ReactNode;
}

/** A drag on the canvas, as a layer and a snap rule see it. Slide px. */
export interface CanvasDrag {
  kind: 'move' | 'resize' | 'rotate' | 'marquee';
  /** The elements being moved or resized (top level). */
  ids: readonly string[];
  /** Where their union box is now, before snapping. */
  box: Box;
  /** The handle being dragged, for a resize. */
  handle: Handle | null;
}

/** What a canvas layer is handed. */
export interface CanvasFrame {
  /** The slide on screen, with the drag's preview applied. */
  slide: SlideJSON;
  /** Screen px per slide px. */
  scale: number;
  /** Slide px. */
  width: number;
  height: number;
  drag: CanvasDrag | null;
}

/** Drawn over the slide, in a box the slide's size on screen (multiply slide px by `frame.scale`). */
export interface CanvasLayer {
  id: string;
  render: (c: SlidesContext, frame: CanvasFrame) => ReactNode;
}

/** A guide line, slide px: `axis: 'x'` is a vertical line at x = `at`, from y = `from` to `to`. */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
}

export interface SnapResult {
  /** Slide px to add to the drag. */
  dx: number;
  dy: number;
  guides: Guide[];
}

/** What a snap rule is asked with, beside the box. */
export interface SnapContext {
  ctx: SlidesContext;
  /** The slide as it is, without the drag. */
  slide: SlideJSON;
  drag: CanvasDrag;
  /** Slide px. */
  width: number;
  height: number;
  /** Screen px per slide px: a rule that snaps within 6 screen px uses `6 / scale`. */
  scale: number;
}

/** A view in place of Normal: the slide sorter. */
export interface SlidesView {
  id: string;
  label: string;
  icon?: PhIcon;
  /** After Normal (0); lower is further left in the footer and the View tab. */
  order: number;
  render: (c: SlidesContext) => ReactNode;
}

/** The slide show. One module provides it. */
export interface Presenter {
  render: (c: SlidesContext, show: { from: number; close: () => void }) => ReactNode;
}

export interface SlidesModule {
  /** `core`, `design`, `format`, `present`. Unique. */
  id: string;
  ribbon: RibbonGroup<SlidesContext>[];
  /** Commands for the Ctrl+K box. */
  commands: Command<SlidesContext>[];
  keys?: SlidesKey[];
  panes?: PaneSpec<SlidesContext>[];
  statusItems?: StatusItem<SlidesContext>[];
  fileItems?: FileItem<SlidesContext>[];
  /** Entries in the "Editing" menu at the right of the tab row. */
  modes?: EditingMode[];
  overlays?: SlidesOverlay[];
  canvas?: CanvasLayer[];
  /** Where a dragged box would rather be. Null for "no opinion"; the next module is asked. */
  snap?: (box: Box, s: SnapContext) => SnapResult | null;
  views?: SlidesView[];
  presenter?: Presenter;
  /** Rows for the right-click menu over a shape, the slide's ground or a thumbnail. Empty groups are skipped. */
  contextItems?: ContextHook<SlidesMenuTarget, SlidesContext>;
}
