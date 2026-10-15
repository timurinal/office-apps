/**
 * Layout: the page view. Paper, margins and orientation; print layout and web layout;
 * headers and footers; page breaks, footnotes and a table of contents; print.
 *
 *   Layout       Margins, Orientation, Size, Page setup; Page break
 *   Insert       Page break; Header, Footer
 *   References   Table of contents, Update table; Insert footnote
 *   View         Print layout, Web layout
 *
 * And the footer's "Page 2 of 7" at the left and the view switch at the right, the File
 * menu's Page setup, and the Ctrl+K box's commands for each.
 *
 * The work is in `docs/pagination/` (plugin.ts says how a pass runs): a view-only
 * layer that measures the page after each change and draws the breaks as decorations, so
 * where a page ends is never written to the document. What is written is the page setup,
 * to the Yjs map `page`, the headers and footers, to their own fragments, and the nodes
 * this adds: a page break, a footnote, a table of contents.
 *
 * Print needs nothing here: Ctrl+P and File > Print print the page as it is laid out, with
 * the `@page` rule the plugin writes, so what comes out is the screen's pages.
 */

import type { Editor } from '@tiptap/core';
import { fileTextIcon, globeSimpleIcon } from '../../core/icons';
import { mod } from '../../core/keys';
import type { MenuEntry } from '../../core/shell/types';
import { viewOf } from '../core/hooks';
import { listDashesIcon } from '../core/icons';
import { Pagination, pageStoreOf } from '../pagination/extension';
import {
  alignBottomIcon,
  alignTopIcon,
  arrowsClockwiseIcon,
  deviceRotateIcon,
  fileIcon,
  frameCornersIcon,
  notebookIcon,
  rulerIcon,
  squareSplitVerticalIcon
} from '../pagination/icons';
import { tocViews } from '../pagination/nodes';
import '../pagination/pagination.css';
import { MARGIN_PRESETS, PAPER, PAPER_SIZES, presetOf, type Orientation, type PageSetup, type PaperSize } from '../pagination/setup';
import { openPageSetup, PagesHost, ViewSwitch } from '../pagination/ui';
import type { DocsContext, DocsModule } from './types';

// ── small helpers ───────────────────────────────────────────────────────────

const cannotEdit = (c: DocsContext): boolean => !c.can.edit;

/** The page setup as the document says it, or null before the editor mounts. */
const setupOf = (c: DocsContext): PageSetup | null => pageStoreOf(c.editor)?.setup ?? null;

const isPaged = (c: DocsContext): boolean => pageStoreOf(c.editor)?.info.paged ?? true;
const isNarrow = (c: DocsContext): boolean => pageStoreOf(c.editor)?.narrow ?? false;

const run = (c: DocsContext, fn: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>): void => {
  if (c.editor) fn(c.editor.chain().focus()).run();
};

const setPage = (c: DocsContext, patch: Partial<PageSetup>): void => {
  c.editor?.commands.setPageSetup(patch);
};

const pageBreak = (c: DocsContext): void => run(c, (ch) => ch.setPageBreak());
const footnote = (c: DocsContext): void => run(c, (ch) => ch.insertFootnote());
const toc = (c: DocsContext): void => run(c, (ch) => ch.insertTableOfContents());
const updateToc = (c: DocsContext): void => run(c, (ch) => ch.updateTableOfContents());
const editHF = (c: DocsContext, kind: 'header' | 'footer'): void => {
  c.editor?.commands.editHeaderFooter(kind);
};
const setView = (c: DocsContext, paged: boolean): void => {
  c.editor?.commands.setPaged(paged);
};

const noToc = (c: DocsContext): boolean => {
  const view = viewOf(c.editor);
  return !view || tocViews(view).length === 0;
};

// ── menus ───────────────────────────────────────────────────────────────────

const marginEntries: MenuEntry<DocsContext>[] = [
  ...MARGIN_PRESETS.map<MenuEntry<DocsContext>>((p) => ({
    label: p.label,
    active: (c) => {
      const s = setupOf(c);
      return !!s && presetOf(s.margins) === p.id;
    },
    run: (c) => setPage(c, { margins: { ...p.margins } }),
    disabled: cannotEdit
  })),
  {
    label: 'Custom margins…',
    separated: true,
    active: (c) => {
      const s = setupOf(c);
      return !!s && presetOf(s.margins) === null;
    },
    run: (c) => openPageSetup(c.editor),
    disabled: cannotEdit
  }
];

const ORIENTATIONS: readonly { to: Orientation; label: string }[] = [
  { to: 'portrait', label: 'Portrait' },
  { to: 'landscape', label: 'Landscape' }
];

const orientationEntries: MenuEntry<DocsContext>[] = ORIENTATIONS.map((o) => ({
  label: o.label,
  active: (c) => setupOf(c)?.orientation === o.to,
  run: (c) => setPage(c, { orientation: o.to }),
  disabled: cannotEdit
}));

const SIZE_NOTE: Record<PaperSize, string> = { A4: '210 × 297 mm', Letter: '8.5 × 11 in', Legal: '8.5 × 14 in', A5: '148 × 210 mm' };

const sizeEntries: MenuEntry<DocsContext>[] = PAPER_SIZES.map((s) => ({
  label: `${PAPER[s].label}, ${SIZE_NOTE[s]}`,
  active: (c) => setupOf(c)?.size === s,
  run: (c) => setPage(c, { size: s }),
  disabled: cannotEdit
}));

// ── the module ──────────────────────────────────────────────────────────────

export const layoutModule: DocsModule = {
  id: 'layout',
  extensions: [Pagination],

  ribbon: [
    // Layout ───────────────────────────────────────────────────────────────
    {
      id: 'layout.page',
      tab: 'layout',
      order: 100,
      label: 'Page setup',
      items: [
        { type: 'menu', id: 'layout.margins', label: 'Margins', icon: frameCornersIcon, showLabel: true, entries: marginEntries, disabled: cannotEdit },
        { type: 'menu', id: 'layout.orientation', label: 'Orientation', icon: deviceRotateIcon, showLabel: true, entries: orientationEntries, disabled: cannotEdit },
        { type: 'menu', id: 'layout.size', label: 'Size', icon: fileIcon, showLabel: true, entries: sizeEntries, disabled: cannotEdit },
        { type: 'button', id: 'layout.setup', label: 'Page setup', icon: rulerIcon, showLabel: true, run: (c) => openPageSetup(c.editor), disabled: cannotEdit }
      ]
    },
    {
      id: 'layout.breaks',
      tab: 'layout',
      order: 200,
      label: 'Breaks',
      items: [{ type: 'button', id: 'layout.page-break', label: 'Page break', icon: squareSplitVerticalIcon, shortcut: mod('Enter'), showLabel: true, run: pageBreak, disabled: cannotEdit }]
    },

    // Insert ───────────────────────────────────────────────────────────────
    {
      id: 'insert.pages',
      tab: 'insert',
      order: 50,
      label: 'Pages',
      items: [{ type: 'button', id: 'insert.page-break', label: 'Page break', icon: squareSplitVerticalIcon, shortcut: mod('Enter'), showLabel: true, run: pageBreak, disabled: cannotEdit }]
    },
    {
      id: 'insert.header-footer',
      tab: 'insert',
      order: 600,
      label: 'Header and footer',
      items: [
        { type: 'button', id: 'insert.header', label: 'Header', icon: alignTopIcon, showLabel: true, run: (c) => editHF(c, 'header'), disabled: (c) => cannotEdit(c) || isNarrow(c) },
        { type: 'button', id: 'insert.footer', label: 'Footer', icon: alignBottomIcon, showLabel: true, run: (c) => editHF(c, 'footer'), disabled: (c) => cannotEdit(c) || isNarrow(c) }
      ]
    },

    // References ───────────────────────────────────────────────────────────
    {
      id: 'references.toc',
      tab: 'references',
      order: 100,
      label: 'Table of contents',
      items: [
        { type: 'button', id: 'references.toc', label: 'Table of contents', icon: listDashesIcon, showLabel: true, run: toc, disabled: cannotEdit },
        { type: 'button', id: 'references.update-toc', label: 'Update table', icon: arrowsClockwiseIcon, showLabel: true, run: updateToc, disabled: (c) => cannotEdit(c) || noToc(c) }
      ]
    },
    {
      id: 'references.footnotes',
      tab: 'references',
      order: 200,
      label: 'Footnotes',
      items: [{ type: 'button', id: 'references.footnote', label: 'Insert footnote', icon: notebookIcon, shortcut: mod('Alt+F'), showLabel: true, run: footnote, disabled: cannotEdit }]
    },

    // View ─────────────────────────────────────────────────────────────────
    {
      id: 'view.views',
      tab: 'view',
      order: 50,
      label: 'Views',
      items: [
        { type: 'button', id: 'view.print-layout', label: 'Print layout', icon: fileTextIcon, showLabel: true, active: isPaged, run: (c) => setView(c, true), disabled: isNarrow },
        { type: 'button', id: 'view.web-layout', label: 'Web layout', icon: globeSimpleIcon, showLabel: true, active: (c) => !isPaged(c), run: (c) => setView(c, false), disabled: isNarrow }
      ]
    }
  ],

  commands: [
    { id: 'layout.page-break', title: 'Insert a page break', section: 'Insert', icon: squareSplitVerticalIcon, shortcut: mod('Enter'), keywords: ['new page'], visible: (c) => c.can.edit, run: pageBreak },
    { id: 'layout.footnote', title: 'Insert a footnote', section: 'Insert', icon: notebookIcon, shortcut: mod('Alt+F'), keywords: ['note', 'reference', 'citation'], visible: (c) => c.can.edit, run: footnote },
    { id: 'layout.toc', title: 'Insert a table of contents', section: 'Insert', icon: listDashesIcon, keywords: ['contents', 'toc', 'index'], visible: (c) => c.can.edit, run: toc },
    { id: 'layout.update-toc', title: 'Update the table of contents', section: 'Insert', icon: arrowsClockwiseIcon, keywords: ['contents', 'toc', 'refresh'], visible: (c) => c.can.edit, disabled: noToc, run: updateToc },
    { id: 'layout.header', title: 'Edit the header', section: 'Layout', icon: alignTopIcon, keywords: ['page number', 'heading'], visible: (c) => c.can.edit, run: (c) => editHF(c, 'header') },
    { id: 'layout.footer', title: 'Edit the footer', section: 'Layout', icon: alignBottomIcon, keywords: ['page number'], visible: (c) => c.can.edit, run: (c) => editHF(c, 'footer') },
    { id: 'layout.setup', title: 'Page setup', section: 'Layout', icon: rulerIcon, keywords: ['margins', 'paper', 'size', 'a4', 'letter', 'orientation'], visible: (c) => c.can.edit, run: (c) => openPageSetup(c.editor) },
    ...ORIENTATIONS.map((o) => ({
      id: `layout.${o.to}`,
      title: o.label,
      section: 'Layout',
      icon: deviceRotateIcon,
      keywords: ['orientation', 'page'],
      visible: (c: DocsContext) => c.can.edit,
      run: (c: DocsContext) => setPage(c, { orientation: o.to })
    })),
    { id: 'view.print-layout', title: 'Print layout', section: 'View', icon: fileTextIcon, keywords: ['pages', 'paged'], run: (c) => setView(c, true) },
    { id: 'view.web-layout', title: 'Web layout', section: 'View', icon: globeSimpleIcon, keywords: ['pageless', 'continuous'], run: (c) => setView(c, false) }
  ],

  statusItems: [
    // Before the word count, where Word has it. Also carries the dialog and the header toolbar.
    { id: 'layout.pages', side: 'left', order: 5, render: (c) => <PagesHost ctx={c} /> },
    { id: 'layout.views', side: 'right', order: 10, render: (c) => <ViewSwitch ctx={c} /> }
  ],

  fileItems: [{ id: 'file.page-setup', label: 'Page setup', icon: rulerIcon, section: 'Export', order: 690, visible: (c) => c.can.edit, run: (c) => openPageSetup(c.editor) }]
};
