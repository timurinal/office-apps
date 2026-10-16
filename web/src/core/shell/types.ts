/**
 * What an editor's modules contribute to its shell, as plain data.
 *
 * Every editor (Docs now, Sheets and Slides later) is one shell and a list of
 * modules. A module is a file that exports its pieces and is listed in one index;
 * nothing else changes when it is added. The pieces here are generic over `C`,
 * the context the editor hands its predicates and its commands (Docs' is
 * `DocsContext`), so the shell knows nothing about Tiptap or Yjs.
 *
 *   RibbonGroup   a labelled run of controls on a tab, placed by `tab` and `order`
 *   Command       a thing the Ctrl+K box can run
 *   PaneSpec      a glass pane on the left or right edge
 *   StatusItem    a piece of the footer
 *   FileItem      a row in the File menu
 *   EditingMode   an entry in the "Editing" menu at the right of the tab row
 *
 * Predicates (`visible`, `disabled`, `active`, `value`) read the context and must
 * be cheap and side-effect free: the ribbon calls them on every selection change.
 */

import type { CSSProperties, ReactNode } from 'react';
import type { PhIcon } from '../icons';

export interface TabDef {
  id: string;
  label: string;
}

// ── the ribbon ──────────────────────────────────────────────────────────────

interface ItemBase<C> {
  /** Unique within the document: `home.bold`. */
  id: string;
  label: string;
  icon?: PhIcon;
  /** Shown in the tooltip and next to a menu row: `Ctrl+B`. */
  shortcut?: string;
  /** False hides it (a server feature on a local file). Defaults to shown. */
  visible?: (c: C) => boolean;
  disabled?: (c: C) => boolean;
}

/** A tool button: an icon, or an icon and a label, that does one thing. */
export interface ButtonItem<C> extends ItemBase<C> {
  type: 'button';
  run: (c: C) => void;
  /** Pressed. Makes it a toggle button. */
  active?: (c: C) => boolean;
  /** Draw the label beside the icon. */
  showLabel?: boolean;
}

export interface MenuEntry<C> {
  label: string;
  icon?: PhIcon;
  shortcut?: string;
  run: (c: C) => void;
  active?: (c: C) => boolean;
  disabled?: (c: C) => boolean;
  visible?: (c: C) => boolean;
  danger?: boolean;
  separated?: boolean;
}

/** A button that does its one thing, and a chevron that opens a menu of variants. */
export interface SplitItem<C> extends ItemBase<C> {
  type: 'split';
  run: (c: C) => void;
  active?: (c: C) => boolean;
  showLabel?: boolean;
  menu: MenuEntry<C>[];
}

/** A button that only opens a menu: "Find ⌄", "Accept ⌄". */
export interface MenuItem<C> extends ItemBase<C> {
  type: 'menu';
  showLabel?: boolean;
  entries: MenuEntry<C>[];
}

export interface Choice {
  value: string;
  label: string;
  /** How the option draws itself: a font name in its own font. */
  style?: CSSProperties;
}

/** A dropdown showing its current value: the font and its size. */
export interface SelectItem<C> extends ItemBase<C> {
  type: 'select';
  width: number;
  options: Choice[];
  value: (c: C) => string;
  run: (c: C, value: string) => void;
}

/** A strip of named styles that apply to the paragraph: Normal, Heading 1, Title. */
export interface GalleryItem<C> extends ItemBase<C> {
  type: 'gallery';
  entries: Choice[];
  value: (c: C) => string;
  run: (c: C, value: string) => void;
}

export interface Swatch {
  value: string;
  label: string;
}

/** A colour: the glyph with a bar of the current colour under it, and a palette. */
export interface ColorItem<C> extends ItemBase<C> {
  type: 'color';
  palette: Swatch[];
  /** The colour at the selection, or null for none. */
  value: (c: C) => string | null;
  /** `null` clears the colour. */
  run: (c: C, color: string | null) => void;
  /** The text for the glyph when `icon` is not set: "A". */
  glyph?: string;
  clearLabel?: string;
}

export interface SeparatorItem {
  type: 'separator';
  id: string;
}

/** Anything the others cannot say. Prefer the others: a custom item does not get
 *  the roving keyboard focus unless it carries `data-rb-item`. */
export interface CustomItem<C> {
  type: 'custom';
  id: string;
  visible?: (c: C) => boolean;
  render: (c: C) => ReactNode;
}

export type RibbonItem<C> =
  | ButtonItem<C>
  | SplitItem<C>
  | MenuItem<C>
  | SelectItem<C>
  | GalleryItem<C>
  | ColorItem<C>
  | SeparatorItem
  | CustomItem<C>;

/**
 * A group on a tab. The contribution is the group: `tab` says where it goes and
 * `order` says where in the tab (lower is further left). Core uses 100, 200, 300 …
 * on Home so a module can slot in between with 150.
 */
export interface RibbonGroup<C> {
  /** `home.clipboard`. Unique. */
  id: string;
  tab: string;
  order: number;
  /** The group's accessible name. */
  label: string;
  items: RibbonItem<C>[];
}

// ── commands ────────────────────────────────────────────────────────────────

export interface Command<C> {
  id: string;
  title: string;
  /** A group heading in the results: "File", "Format", "Insert". */
  section: string;
  icon?: PhIcon;
  shortcut?: string;
  /** Extra words the search matches: "bold, strong". */
  keywords?: string[];
  visible?: (c: C) => boolean;
  disabled?: (c: C) => boolean;
  run: (c: C) => void;
}

// ── panes, status, file, modes ──────────────────────────────────────────────

export interface PaneSpec<C> {
  id: string;
  side: 'left' | 'right';
  title: string;
  width: number;
  /** The pane's accessible name. Defaults to the title. */
  label?: string;
  visible?: (c: C) => boolean;
  /** `close` closes this pane. */
  render: (c: C, close: () => void) => ReactNode;
}

export interface StatusItem<C> {
  id: string;
  side: 'left' | 'right';
  order: number;
  visible?: (c: C) => boolean;
  render: (c: C) => ReactNode;
}

export interface FileItem<C> {
  id: string;
  label: string;
  icon?: PhIcon;
  shortcut?: string;
  /** Rows with the same section are kept together, sections in the order of the first `order` in each. */
  section: string;
  order: number;
  visible?: (c: C) => boolean;
  disabled?: (c: C) => boolean;
  danger?: boolean;
  run: (c: C) => void;
  /**
   * Opens a menu of these choices beside the row (a chevron), and `run` is then not called: "Download
   * a copy", "Save as". The row goes when none of its choices is visible.
   */
  submenu?: readonly FileChoice<C>[];
}

/** What a submenu row lists: the kind's formats, "Document (.docx)". */
export interface FileChoice<C> {
  id: string;
  label: string;
  icon?: PhIcon;
  shortcut?: string;
  visible?: (c: C) => boolean;
  disabled?: (c: C) => boolean;
  run: (c: C) => void;
}

export interface EditingMode {
  id: string;
  label: string;
  icon?: PhIcon;
  order: number;
  description?: string;
}
