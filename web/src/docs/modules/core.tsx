/**
 * The core module: what every Docs document needs.
 *
 *   Home      undo and redo; the format painter and clear formatting; font and size; bold,
 *             italic, underline, strikethrough, subscript, superscript, highlight and text
 *             colour; lists and indent; alignment and spacing; the paragraph styles; find
 *   Insert    a table (a grid to sweep out, and a menu of what to do to one), a picture, a
 *             link, smart chips, a horizontal line, a code block, special characters
 *   View      the outline pane, the word count
 *
 * And the File menu's rows, the commands the Ctrl+K box runs, the footer's word count and
 * connection, and the Editing and Viewing modes.
 *
 * The code behind each of those is in `docs/core/`, one file to a feature, and this file
 * only says where each goes on the ribbon. Ribbon groups are numbered 100, 200 … so another
 * module can slot a group between them.
 *
 * ── Things worth knowing ────────────────────────────────────────────────────
 * **The overlays** (the link editor, the @ picker, the find bar, two dialogs) have no slot
 * in a module, so they are drawn by `CoreHost`, which rides on a footer item
 * (`status.core-host`) and portals into the shell. See core/Host.tsx.
 *
 * **Ctrl+K in the page is Insert link**, as in Word and Docs; the command box keeps Ctrl+K
 * everywhere else and is Ctrl+/ from inside the page. See core/keys.ts.
 *
 * A control that is disabled for a reader is disabled by `can.edit`, never by a role.
 */

import type { Editor } from '@tiptap/core';
import {
  arrowUUpLeftIcon,
  arrowUUpRightIcon,
  calendarBlankIcon,
  clockCounterClockwiseIcon,
  codeBlockIcon,
  copyIcon,
  eraserIcon,
  eyeIcon,
  filePlusIcon,
  folderOpenIcon,
  highlighterCircleIcon,
  linkIcon,
  listBulletsIcon,
  listNumbersIcon,
  lockKeyIcon,
  lockSimpleIcon,
  magnifyingGlassIcon,
  minusIcon,
  paintBrushIcon,
  paintBucketIcon,
  pencilSimpleIcon,
  printerIcon,
  tableIcon,
  textAaIcon,
  textAlignLeftIcon,
  textBIcon,
  textIndentIcon,
  textItalicIcon,
  textOutdentIcon,
  textStrikethroughIcon,
  textSubscriptIcon,
  textSuperscriptIcon,
  textUnderlineIcon,
  trashIcon,
  usersIcon
} from '../../core/icons';
import { mod } from '../../core/keys';
import type { Choice, MenuEntry } from '../../core/shell/types';
import { isoDay } from '../core/chipText';
import { HIGHLIGHT_COLORS, SHADING_COLORS, TEXT_COLORS } from '../core/colors';
import '../core/core.css';
import { coreExtensions } from '../core/extensions';
import { openFind } from '../core/find';
import { DEFAULT_FONT, FONT_CHOICES } from '../core/fonts';
import { CoreHost } from '../core/Host';
import {
  arrowsMergeIcon,
  arrowsSplitIcon,
  arrowsVerticalIcon,
  atIcon,
  calendarPlusIcon,
  columnsMinusIcon,
  columnsPlusLeftIcon,
  columnsPlusRightIcon,
  imageSquareIcon,
  listChecksIcon,
  listMagnifyingGlassIcon,
  rowsMinusIcon,
  rowsPlusBottomIcon,
  rowsPlusTopIcon,
  sigmaIcon,
  treeStructureIcon
} from '../core/icons';
import { pickPictureFiles } from '../core/images';
import { LIST_FORMATS, listFormatAt, setListFormat } from '../core/lists';
import { OutlinePane } from '../core/OutlinePane';
import { applyStyle, canOutdent, hasSpace, indent, LINE_HEIGHTS, lineHeightAt, setLineHeight, setSpace, SPACE_STEP, styleAt, type StyleId } from '../core/paragraph';
import { FontSizeBox, PictureButton, TableButton } from '../core/ribbonControls';
import { inTable, setShading, shadingAt } from '../core/tables';
import {
  alignAt,
  armFormatPainter,
  clearFormatting,
  colorAt,
  disarm,
  fontAt,
  highlightAt,
  isPainting,
  setAlign,
  setFont,
  setHighlight,
  setTextColor,
  type Align
} from '../core/text';
import { openChars, openCount, openLink } from '../core/ui';
import { WordCountStatus } from '../core/WordCount';
import type { DocsContext, DocsModule } from './types';

// ── small helpers ───────────────────────────────────────────────────────────

/** Run a chain on the editor, with focus put back in the page first. */
const run = (c: DocsContext, fn: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>): void => {
  if (c.editor) fn(c.editor.chain().focus()).run();
};

const on = (c: DocsContext, name: string, attrs?: Record<string, unknown>): boolean => c.editor?.isActive(name, attrs) ?? false;

/** Everything that changes the page is off for a reader, in the trash, and in Viewing mode. */
const cannotEdit = (c: DocsContext): boolean => !c.can.edit;

/** Table commands are on while the caret is in a table, and only then. */
const outsideTable = (c: DocsContext): boolean => cannotEdit(c) || !c.editor || !inTable(c.editor);

const can = (c: DocsContext, probe: (e: Editor) => boolean): boolean => !!c.editor && probe(c.editor);

// ── paragraph styles ────────────────────────────────────────────────────────

const STYLES: ReadonlyArray<{ id: StyleId; label: string; style: Choice['style']; keywords?: string[]; shortcut?: string }> = [
  { id: 'normal', label: 'Normal', style: { fontSize: 13 }, keywords: ['paragraph', 'body'], shortcut: mod('Alt+0') },
  { id: 'nospacing', label: 'No spacing', style: { fontSize: 13 }, keywords: ['compact', 'tight'] },
  { id: 'title', label: 'Title', style: { fontSize: 17, fontWeight: 600 } },
  { id: 'subtitle', label: 'Subtitle', style: { fontSize: 13, color: 'var(--fg-3)' } },
  { id: 'h1', label: 'Heading 1', style: { fontSize: 15, fontWeight: 600 }, shortcut: mod('Alt+1') },
  { id: 'h2', label: 'Heading 2', style: { fontSize: 13.5, fontWeight: 600, color: 'var(--app-text)' }, shortcut: mod('Alt+2') },
  { id: 'h3', label: 'Heading 3', style: { fontSize: 13, fontWeight: 600 }, shortcut: mod('Alt+3') },
  { id: 'h4', label: 'Heading 4', style: { fontSize: 13, fontWeight: 600 } },
  { id: 'h5', label: 'Heading 5', style: { fontSize: 12.5, fontWeight: 600 } },
  { id: 'h6', label: 'Heading 6', style: { fontSize: 12.5, fontWeight: 600 } },
  { id: 'quote', label: 'Quote', style: { fontSize: 13, fontStyle: 'italic' }, keywords: ['blockquote'] },
  { id: 'code', label: 'Code', style: { fontSize: 12.5, fontFamily: 'var(--font-mono), monospace' }, keywords: ['monospace', 'preformatted'] }
];

/** What the gallery draws in its row; every style, No spacing included, is in the menu beside
 *  it. The board draws five; with the controls Word has and the board leaves out, five do not
 *  fit one row at 1440px, so the least used of them goes to the menu. */
const GALLERY: Choice[] = (['normal', 'h1', 'h2', 'title'] as const).map((id) => {
  const s = STYLES.find((x) => x.id === id)!;
  return { value: s.id, label: s.label, ...(s.style ? { style: s.style } : {}) };
});

const currentStyle = (c: DocsContext): StyleId => (c.editor ? styleAt(c.editor.state) : 'normal');
const setStyle = (c: DocsContext, id: string): void => {
  if (c.editor) applyStyle(c.editor, id as StyleId);
};

const styleEntries: MenuEntry<DocsContext>[] = STYLES.map((s) => ({
  label: s.label,
  ...(s.shortcut ? { shortcut: s.shortcut } : {}),
  active: (c: DocsContext) => currentStyle(c) === s.id,
  run: (c: DocsContext) => setStyle(c, s.id),
  disabled: cannotEdit
}));

// ── alignment, spacing, lists ───────────────────────────────────────────────

// The shortcuts that work in every browser: Ctrl+Shift+L, E, R and J. Ctrl+E and Ctrl+J also
// align, as in Word, but Ctrl+L and Ctrl+R are the address bar and reload (core/keys.ts).
const ALIGNS: ReadonlyArray<{ to: Align; label: string; key: string }> = [
  { to: 'left', label: 'Align left', key: 'Shift+L' },
  { to: 'center', label: 'Centre', key: 'Shift+E' },
  { to: 'right', label: 'Align right', key: 'Shift+R' },
  { to: 'justify', label: 'Justify', key: 'Shift+J' }
];

const alignEntries: MenuEntry<DocsContext>[] = ALIGNS.map((a) => ({
  label: a.label,
  shortcut: mod(a.key),
  active: (c: DocsContext) => (c.editor ? alignAt(c.editor) === a.to : false),
  run: (c: DocsContext) => {
    if (c.editor) setAlign(c.editor, a.to);
  },
  disabled: cannotEdit
}));

const spacingEntries: MenuEntry<DocsContext>[] = [
  {
    label: 'Default',
    active: (c) => !c.editor || lineHeightAt(c.editor.state) === null,
    run: (c) => {
      if (c.editor) setLineHeight(c.editor, null);
    },
    disabled: cannotEdit
  },
  ...LINE_HEIGHTS.map<MenuEntry<DocsContext>>((v) => ({
    label: v.toFixed(v === 1.15 ? 2 : 1),
    active: (c) => (c.editor ? lineHeightAt(c.editor.state) === v : false),
    run: (c) => {
      if (c.editor) setLineHeight(c.editor, v);
    },
    disabled: cannotEdit
  })),
  ...(['spaceBefore', 'spaceAfter'] as const).map<MenuEntry<DocsContext>>((which, i) => ({
    label: i === 0 ? 'Space before paragraph' : 'Space after paragraph',
    active: (c) => (c.editor ? hasSpace(c.editor.state, which) : false),
    // A toggle: Word's "Add space before" and "Remove space before" are one entry.
    run: (c) => {
      if (c.editor) setSpace(c.editor, which, hasSpace(c.editor.state, which) ? null : SPACE_STEP);
    },
    disabled: cannotEdit,
    separated: i === 0
  }))
];

const listFormatEntries: MenuEntry<DocsContext>[] = LIST_FORMATS.map((f) => ({
  label: f.label,
  active: (c: DocsContext) => (c.editor ? listFormatAt(c.editor) === f.value : false),
  run: (c: DocsContext) => {
    if (c.editor) setListFormat(c.editor, f.value);
  },
  disabled: cannotEdit
}));

// ── tables ──────────────────────────────────────────────────────────────────

const tableEntries: MenuEntry<DocsContext>[] = [
  { label: 'Add row above', icon: rowsPlusTopIcon, run: (c) => run(c, (ch) => ch.addRowBefore()), disabled: (c) => !can(c, (e) => e.can().addRowBefore()) },
  { label: 'Add row below', icon: rowsPlusBottomIcon, run: (c) => run(c, (ch) => ch.addRowAfter()), disabled: (c) => !can(c, (e) => e.can().addRowAfter()) },
  { label: 'Add column left', icon: columnsPlusLeftIcon, run: (c) => run(c, (ch) => ch.addColumnBefore()), disabled: (c) => !can(c, (e) => e.can().addColumnBefore()) },
  { label: 'Add column right', icon: columnsPlusRightIcon, run: (c) => run(c, (ch) => ch.addColumnAfter()), disabled: (c) => !can(c, (e) => e.can().addColumnAfter()) },
  { label: 'Delete row', icon: rowsMinusIcon, run: (c) => run(c, (ch) => ch.deleteRow()), disabled: (c) => !can(c, (e) => e.can().deleteRow()), separated: true },
  { label: 'Delete column', icon: columnsMinusIcon, run: (c) => run(c, (ch) => ch.deleteColumn()), disabled: (c) => !can(c, (e) => e.can().deleteColumn()) },
  { label: 'Merge cells', icon: arrowsMergeIcon, run: (c) => run(c, (ch) => ch.mergeCells()), disabled: (c) => !can(c, (e) => e.can().mergeCells()), separated: true },
  { label: 'Split cell', icon: arrowsSplitIcon, run: (c) => run(c, (ch) => ch.splitCell()), disabled: (c) => !can(c, (e) => e.can().splitCell()) },
  { label: 'Header row', active: (c) => on(c, 'tableHeader'), run: (c) => run(c, (ch) => ch.toggleHeaderRow()), disabled: (c) => !can(c, (e) => e.can().toggleHeaderRow()), separated: true },
  { label: 'Delete table', icon: trashIcon, run: (c) => run(c, (ch) => ch.deleteTable()), disabled: (c) => !can(c, (e) => e.can().deleteTable()), danger: true, separated: true }
];

// ── the footer ──────────────────────────────────────────────────────────────

const CONNECTION: Record<DocsContext['connection'], { label: string; warn: boolean } | null> = {
  live: { label: 'Connected', warn: false },
  connecting: { label: 'Connecting', warn: true },
  offline: { label: 'Offline', warn: true },
  local: { label: 'On this device', warn: false },
  locked: { label: 'Locked', warn: false },
  stopped: null
};

function ConnectionStatus({ ctx }: { ctx: DocsContext }) {
  const c = CONNECTION[ctx.connection];
  if (!c) return null;
  return (
    <span className="oa-status" role="status">
      <span className="oa-dot" data-tone={c.warn ? 'warn' : undefined} />
      {c.label}
    </span>
  );
}

// ── the module ──────────────────────────────────────────────────────────────

export const coreModule: DocsModule = {
  id: 'core',
  extensions: coreExtensions,

  ribbon: [
    // Home ─────────────────────────────────────────────────────────────────
    {
      id: 'home.history',
      tab: 'home',
      order: 100,
      label: 'Undo',
      items: [
        {
          type: 'button',
          id: 'home.undo',
          label: 'Undo',
          icon: arrowUUpLeftIcon,
          shortcut: mod('Z'),
          run: (c) => run(c, (ch) => ch.undo()),
          disabled: (c) => cannotEdit(c) || !c.editor?.can().undo()
        },
        {
          type: 'button',
          id: 'home.redo',
          label: 'Redo',
          icon: arrowUUpRightIcon,
          shortcut: mod('Shift+Z'),
          run: (c) => run(c, (ch) => ch.redo()),
          disabled: (c) => cannotEdit(c) || !c.editor?.can().redo()
        }
      ]
    },
    {
      id: 'home.painter',
      tab: 'home',
      order: 200,
      label: 'Formatting tools',
      items: [
        {
          type: 'button',
          id: 'home.painter',
          label: 'Format painter',
          icon: paintBrushIcon,
          active: (c) => (c.editor ? isPainting(c.editor) : false),
          run: (c) => {
            if (c.editor) isPainting(c.editor) ? disarm(c.editor) : armFormatPainter(c.editor);
          },
          disabled: cannotEdit
        },
        {
          type: 'button',
          id: 'home.clear',
          label: 'Clear formatting',
          icon: eraserIcon,
          shortcut: mod('Space'),
          run: (c) => {
            if (c.editor) clearFormatting(c.editor);
          },
          disabled: cannotEdit
        }
      ]
    },
    {
      id: 'home.font',
      tab: 'home',
      order: 300,
      label: 'Font',
      items: [
        {
          type: 'select',
          id: 'home.font.family',
          label: 'Font',
          width: 128,
          options: FONT_CHOICES,
          value: (c) => (c.editor ? (fontAt(c.editor) ?? DEFAULT_FONT) : DEFAULT_FONT),
          // The document's own font is not stored: choosing it takes the choice away.
          run: (c, v) => {
            if (c.editor) setFont(c.editor, v === DEFAULT_FONT ? null : v);
          },
          disabled: cannotEdit
        },
        { type: 'custom', id: 'home.font.size', render: (c) => <FontSizeBox ctx={c} /> }
      ]
    },
    {
      id: 'home.marks',
      tab: 'home',
      order: 400,
      label: 'Text',
      items: [
        { type: 'button', id: 'home.bold', label: 'Bold', icon: textBIcon, shortcut: mod('B'), active: (c) => on(c, 'bold'), run: (c) => run(c, (ch) => ch.toggleBold()), disabled: cannotEdit },
        { type: 'button', id: 'home.italic', label: 'Italic', icon: textItalicIcon, shortcut: mod('I'), active: (c) => on(c, 'italic'), run: (c) => run(c, (ch) => ch.toggleItalic()), disabled: cannotEdit },
        { type: 'button', id: 'home.underline', label: 'Underline', icon: textUnderlineIcon, shortcut: mod('U'), active: (c) => on(c, 'underline'), run: (c) => run(c, (ch) => ch.toggleUnderline()), disabled: cannotEdit },
        { type: 'button', id: 'home.strike', label: 'Strikethrough', icon: textStrikethroughIcon, shortcut: mod('Shift+X'), active: (c) => on(c, 'strike'), run: (c) => run(c, (ch) => ch.toggleStrike()), disabled: cannotEdit },
        { type: 'button', id: 'home.subscript', label: 'Subscript', icon: textSubscriptIcon, shortcut: mod(','), active: (c) => on(c, 'subscript'), run: (c) => run(c, (ch) => ch.toggleSubscript()), disabled: cannotEdit },
        { type: 'button', id: 'home.superscript', label: 'Superscript', icon: textSuperscriptIcon, shortcut: mod('.'), active: (c) => on(c, 'superscript'), run: (c) => run(c, (ch) => ch.toggleSuperscript()), disabled: cannotEdit },
        {
          type: 'color',
          id: 'home.highlight',
          label: 'Highlight colour',
          icon: highlighterCircleIcon,
          palette: HIGHLIGHT_COLORS,
          clearLabel: 'No highlight',
          value: (c) => (c.editor ? highlightAt(c.editor) : null),
          run: (c, color) => {
            if (c.editor) setHighlight(c.editor, color);
          },
          disabled: cannotEdit
        },
        {
          type: 'color',
          id: 'home.color',
          label: 'Text colour',
          glyph: 'A',
          palette: TEXT_COLORS,
          clearLabel: 'Automatic',
          value: (c) => (c.editor ? colorAt(c.editor) : null),
          run: (c, color) => {
            if (c.editor) setTextColor(c.editor, color);
          },
          disabled: cannotEdit
        }
      ]
    },
    {
      id: 'home.paragraph',
      tab: 'home',
      order: 500,
      label: 'Paragraph',
      items: [
        { type: 'button', id: 'home.bullets', label: 'Bulleted list', icon: listBulletsIcon, shortcut: mod('Shift+8'), active: (c) => on(c, 'bulletList'), run: (c) => run(c, (ch) => ch.toggleBulletList()), disabled: cannotEdit },
        {
          // The button numbers the list; the chevron picks how the levels are numbered.
          type: 'split',
          id: 'home.numbering',
          label: 'Numbered list',
          icon: listNumbersIcon,
          shortcut: mod('Shift+7'),
          active: (c) => on(c, 'orderedList'),
          run: (c) => run(c, (ch) => ch.toggleOrderedList()),
          menu: listFormatEntries,
          disabled: cannotEdit
        },
        { type: 'button', id: 'home.checklist', label: 'Checklist', icon: listChecksIcon, shortcut: mod('Shift+9'), active: (c) => on(c, 'taskList'), run: (c) => run(c, (ch) => ch.toggleTaskList()), disabled: cannotEdit },
        {
          type: 'button',
          id: 'home.outdent',
          label: 'Decrease indent',
          icon: textOutdentIcon,
          shortcut: mod('Shift+M'),
          run: (c) => {
            if (c.editor) indent(c.editor, -1);
          },
          disabled: (c) => cannotEdit(c) || !c.editor || !canOutdent(c.editor)
        },
        {
          type: 'button',
          id: 'home.indent',
          label: 'Increase indent',
          icon: textIndentIcon,
          shortcut: mod('M'),
          run: (c) => {
            if (c.editor) indent(c.editor, 1);
          },
          disabled: cannotEdit
        }
      ]
    },
    {
      id: 'home.align',
      tab: 'home',
      order: 600,
      label: 'Alignment',
      items: [
        { type: 'menu', id: 'home.align', label: 'Alignment', icon: textAlignLeftIcon, entries: alignEntries, disabled: cannotEdit },
        { type: 'menu', id: 'home.spacing', label: 'Line and paragraph spacing', icon: arrowsVerticalIcon, entries: spacingEntries, disabled: cannotEdit }
      ]
    },
    {
      id: 'home.styles',
      tab: 'home',
      order: 700,
      label: 'Styles',
      items: [
        { type: 'gallery', id: 'home.style', label: 'Paragraph style', entries: GALLERY, value: currentStyle, run: setStyle, disabled: cannotEdit },
        { type: 'menu', id: 'home.styles.more', label: 'More styles', entries: styleEntries, disabled: cannotEdit }
      ]
    },
    {
      id: 'home.find',
      tab: 'home',
      order: 800,
      label: 'Find',
      items: [
        {
          type: 'menu',
          id: 'home.find',
          label: 'Find',
          icon: magnifyingGlassIcon,
          showLabel: true,
          entries: [
            {
              label: 'Find',
              shortcut: mod('F'),
              run: (c) => {
                if (c.editor) openFind(c.editor);
              }
            },
            {
              label: 'Replace',
              shortcut: mod('H'),
              visible: (c) => c.can.edit,
              run: (c) => {
                if (c.editor) openFind(c.editor, { replace: true });
              }
            }
          ]
        }
      ]
    },

    // Insert ───────────────────────────────────────────────────────────────
    {
      id: 'insert.table',
      tab: 'insert',
      order: 100,
      label: 'Table',
      items: [
        { type: 'custom', id: 'insert.table', render: (c) => <TableButton ctx={c} /> },
        { type: 'menu', id: 'insert.table-tools', label: 'Edit table', icon: tableIcon, entries: tableEntries, disabled: outsideTable },
        {
          type: 'color',
          id: 'insert.shading',
          label: 'Cell shading',
          icon: paintBucketIcon,
          palette: SHADING_COLORS,
          clearLabel: 'No shading',
          value: (c) => (c.editor ? shadingAt(c.editor) : null),
          run: (c, color) => {
            if (c.editor) setShading(c.editor, color);
          },
          disabled: outsideTable
        }
      ]
    },
    {
      id: 'insert.picture',
      tab: 'insert',
      order: 150,
      label: 'Pictures',
      items: [{ type: 'custom', id: 'insert.picture', render: (c) => <PictureButton ctx={c} /> }]
    },
    {
      id: 'insert.links',
      tab: 'insert',
      order: 200,
      label: 'Links',
      items: [
        {
          type: 'button',
          id: 'insert.link',
          label: 'Link',
          icon: linkIcon,
          shortcut: mod('K'),
          showLabel: true,
          run: (c) => {
            if (c.editor) openLink(c.editor);
          },
          disabled: cannotEdit
        }
      ]
    },
    {
      id: 'insert.chips',
      tab: 'insert',
      order: 250,
      label: 'Smart chips',
      items: [
        {
          type: 'button',
          id: 'insert.mention',
          label: 'Person or document',
          icon: atIcon,
          showLabel: true,
          // Typing the character is what opens the picker, so this does exactly that.
          run: (c) => run(c, (ch) => ch.insertContent('@')),
          disabled: cannotEdit
        },
        {
          type: 'button',
          id: 'insert.date',
          label: 'Date',
          icon: calendarPlusIcon,
          showLabel: true,
          run: (c) => run(c, (ch) => ch.insertContent([{ type: 'dateChip', attrs: { date: isoDay() } }, { type: 'text', text: ' ' }])),
          disabled: cannotEdit
        }
      ]
    },
    {
      id: 'insert.blocks',
      tab: 'insert',
      order: 300,
      label: 'Blocks',
      items: [
        { type: 'button', id: 'insert.rule', label: 'Horizontal line', icon: minusIcon, showLabel: true, run: (c) => run(c, (ch) => ch.setHorizontalRule()), disabled: cannotEdit },
        { type: 'button', id: 'insert.code', label: 'Code block', icon: codeBlockIcon, showLabel: true, active: (c) => on(c, 'codeBlock'), run: (c) => run(c, (ch) => ch.toggleCodeBlock()), disabled: cannotEdit }
      ]
    },
    {
      id: 'insert.symbols',
      tab: 'insert',
      order: 400,
      label: 'Symbols',
      items: [
        {
          type: 'button',
          id: 'insert.symbols',
          label: 'Special characters',
          icon: sigmaIcon,
          showLabel: true,
          run: (c) => {
            if (c.editor) openChars(c.editor);
          },
          disabled: cannotEdit
        }
      ]
    },

    // View ─────────────────────────────────────────────────────────────────
    {
      id: 'view.panes',
      tab: 'view',
      order: 100,
      label: 'Navigation',
      items: [
        { type: 'button', id: 'view.outline', label: 'Outline', icon: listMagnifyingGlassIcon, showLabel: true, active: (c) => c.panes.isOpen('outline'), run: (c) => c.panes.toggle('outline') },
        {
          type: 'button',
          id: 'view.word-count',
          label: 'Word count',
          icon: textAaIcon,
          showLabel: true,
          run: (c) => {
            if (c.editor) openCount(c.editor);
          }
        }
      ]
    }
  ],

  commands: [
    { id: 'file.new', title: 'New document', section: 'File', icon: filePlusIcon, keywords: ['create', 'blank'], visible: (c) => c.can.create, run: (c) => c.actions.newDocument('docs') },
    { id: 'file.new-sheet', title: 'New spreadsheet', section: 'File', icon: filePlusIcon, keywords: ['create', 'excel'], visible: (c) => c.can.create, run: (c) => c.actions.newDocument('sheets') },
    { id: 'file.new-slides', title: 'New presentation', section: 'File', icon: filePlusIcon, keywords: ['create', 'powerpoint', 'deck'], visible: (c) => c.can.create, run: (c) => c.actions.newDocument('slides') },
    { id: 'file.open', title: 'Open another document', section: 'File', icon: folderOpenIcon, keywords: ['home', 'recent'], visible: (c) => c.source.kind !== 'local', run: (c) => c.actions.openHome() },
    { id: 'file.copy', title: 'Make a copy', section: 'File', icon: copyIcon, keywords: ['duplicate'], visible: (c) => c.can.copy, run: (c) => c.actions.copy() },
    { id: 'file.rename', title: 'Rename', section: 'File', icon: pencilSimpleIcon, keywords: ['title'], visible: (c) => c.can.rename, run: (c) => c.actions.focusTitle() },
    { id: 'file.share', title: 'Share', section: 'File', icon: usersIcon, keywords: ['invite', 'link', 'permissions'], visible: (c) => c.can.share, run: (c) => c.actions.share() },
    { id: 'file.lock', title: 'Lock with a password', section: 'File', icon: lockKeyIcon, keywords: ['encrypt', 'protect'], visible: (c) => c.can.lock, run: (c) => c.actions.lock() },
    { id: 'file.unlock', title: 'Remove the password', section: 'File', icon: lockSimpleIcon, keywords: ['unlock'], visible: (c) => c.can.unlock, run: (c) => c.actions.removePassword() },
    { id: 'file.print', title: 'Print', section: 'File', icon: printerIcon, shortcut: mod('P'), visible: (c) => c.can.print, run: (c) => c.actions.print() },
    { id: 'file.trash', title: 'Move to trash', section: 'File', icon: trashIcon, keywords: ['delete'], visible: (c) => c.can.trash, run: (c) => c.actions.trash() },

    { id: 'format.undo', title: 'Undo', section: 'Edit', icon: arrowUUpLeftIcon, shortcut: mod('Z'), visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.undo()) },
    { id: 'format.redo', title: 'Redo', section: 'Edit', icon: arrowUUpRightIcon, shortcut: mod('Shift+Z'), visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.redo()) },
    {
      id: 'edit.find',
      title: 'Find',
      section: 'Edit',
      icon: magnifyingGlassIcon,
      shortcut: mod('F'),
      keywords: ['search'],
      run: (c) => {
        if (c.editor) openFind(c.editor);
      }
    },
    {
      id: 'edit.replace',
      title: 'Find and replace',
      section: 'Edit',
      icon: magnifyingGlassIcon,
      shortcut: mod('H'),
      keywords: ['substitute'],
      visible: (c) => c.can.edit,
      run: (c) => {
        if (c.editor) openFind(c.editor, { replace: true });
      }
    },

    { id: 'format.bold', title: 'Bold', section: 'Format', icon: textBIcon, shortcut: mod('B'), keywords: ['strong'], visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.toggleBold()) },
    { id: 'format.italic', title: 'Italic', section: 'Format', icon: textItalicIcon, shortcut: mod('I'), keywords: ['emphasis'], visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.toggleItalic()) },
    { id: 'format.underline', title: 'Underline', section: 'Format', icon: textUnderlineIcon, shortcut: mod('U'), visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.toggleUnderline()) },
    { id: 'format.strike', title: 'Strikethrough', section: 'Format', icon: textStrikethroughIcon, shortcut: mod('Shift+X'), visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.toggleStrike()) },
    { id: 'format.subscript', title: 'Subscript', section: 'Format', icon: textSubscriptIcon, shortcut: mod(','), visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.toggleSubscript()) },
    { id: 'format.superscript', title: 'Superscript', section: 'Format', icon: textSuperscriptIcon, shortcut: mod('.'), visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.toggleSuperscript()) },
    {
      id: 'format.highlight',
      title: 'Highlight',
      section: 'Format',
      icon: highlighterCircleIcon,
      keywords: ['marker', 'yellow'],
      visible: (c) => c.can.edit,
      run: (c) => {
        if (c.editor) setHighlight(c.editor, HIGHLIGHT_COLORS[0]!.value);
      }
    },
    {
      id: 'format.clear',
      title: 'Clear formatting',
      section: 'Format',
      icon: eraserIcon,
      shortcut: mod('Space'),
      keywords: ['reset', 'plain'],
      visible: (c) => c.can.edit,
      run: (c) => {
        if (c.editor) clearFormatting(c.editor);
      }
    },
    {
      id: 'format.painter',
      title: 'Format painter',
      section: 'Format',
      icon: paintBrushIcon,
      keywords: ['copy formatting', 'paint format'],
      visible: (c) => c.can.edit,
      run: (c) => {
        if (c.editor) armFormatPainter(c.editor);
      }
    },
    { id: 'format.bullets', title: 'Bulleted list', section: 'Format', icon: listBulletsIcon, shortcut: mod('Shift+8'), keywords: ['unordered'], visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.toggleBulletList()) },
    { id: 'format.numbering', title: 'Numbered list', section: 'Format', icon: listNumbersIcon, shortcut: mod('Shift+7'), keywords: ['ordered'], visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.toggleOrderedList()) },
    { id: 'format.checklist', title: 'Checklist', section: 'Format', icon: listChecksIcon, shortcut: mod('Shift+9'), keywords: ['todo', 'tasks', 'checkbox'], visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.toggleTaskList()) },
    {
      id: 'format.multilevel',
      title: 'Multilevel numbering, 1.1.1',
      section: 'Format',
      icon: treeStructureIcon,
      keywords: ['legal', 'outline'],
      visible: (c) => c.can.edit,
      run: (c) => {
        if (c.editor) setListFormat(c.editor, 'legal');
      }
    },
    {
      id: 'format.indent',
      title: 'Increase indent',
      section: 'Format',
      icon: textIndentIcon,
      shortcut: mod('M'),
      visible: (c) => c.can.edit,
      run: (c) => {
        if (c.editor) indent(c.editor, 1);
      }
    },
    {
      id: 'format.outdent',
      title: 'Decrease indent',
      section: 'Format',
      icon: textOutdentIcon,
      shortcut: mod('Shift+M'),
      visible: (c) => c.can.edit,
      run: (c) => {
        if (c.editor) indent(c.editor, -1);
      }
    },
    ...ALIGNS.map((a) => ({
      id: `format.align-${a.to}`,
      title: a.label,
      section: 'Format',
      icon: textAlignLeftIcon,
      shortcut: mod(a.key),
      keywords: ['align', 'alignment', a.to],
      visible: (c: DocsContext) => c.can.edit,
      run: (c: DocsContext) => {
        if (c.editor) setAlign(c.editor, a.to);
      }
    })),
    ...LINE_HEIGHTS.map((v) => ({
      id: `format.line-${v}`,
      title: `Line spacing ${v.toFixed(v === 1.15 ? 2 : 1)}`,
      section: 'Format',
      icon: arrowsVerticalIcon,
      keywords: ['line height'],
      visible: (c: DocsContext) => c.can.edit,
      run: (c: DocsContext) => {
        if (c.editor) setLineHeight(c.editor, v);
      }
    })),
    ...STYLES.map((s) => ({
      id: `format.style-${s.id}`,
      title: s.id === 'normal' ? 'Normal text' : s.label,
      section: 'Format',
      ...(s.shortcut ? { shortcut: s.shortcut } : {}),
      keywords: ['style', ...(s.keywords ?? []), ...(s.id.startsWith('h') ? [s.id] : [])],
      visible: (c: DocsContext) => c.can.edit,
      run: (c: DocsContext) => setStyle(c, s.id)
    })),

    { id: 'insert.table', title: 'Insert a table', section: 'Insert', icon: tableIcon, keywords: ['grid'], visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.insertTable({ rows: 3, cols: 3, withHeaderRow: false })) },
    {
      id: 'insert.picture',
      title: 'Insert a picture',
      section: 'Insert',
      icon: imageSquareIcon,
      keywords: ['image', 'photo'],
      visible: (c) => c.can.edit,
      run: (c) => {
        if (c.editor) pickPictureFiles(c.editor);
      }
    },
    {
      id: 'insert.link',
      title: 'Insert a link',
      section: 'Insert',
      icon: linkIcon,
      shortcut: mod('K'),
      keywords: ['hyperlink', 'url'],
      visible: (c) => c.can.edit,
      run: (c) => {
        if (c.editor) openLink(c.editor);
      }
    },
    { id: 'insert.mention', title: 'Mention a person or link a document', section: 'Insert', icon: atIcon, keywords: ['@', 'chip'], visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.insertContent('@')) },
    {
      id: 'insert.date',
      title: 'Insert today’s date',
      section: 'Insert',
      icon: calendarBlankIcon,
      keywords: ['chip', 'today'],
      visible: (c) => c.can.edit,
      run: (c) => run(c, (ch) => ch.insertContent([{ type: 'dateChip', attrs: { date: isoDay() } }, { type: 'text', text: ' ' }]))
    },
    {
      id: 'insert.symbols',
      title: 'Insert a special character',
      section: 'Insert',
      icon: sigmaIcon,
      keywords: ['symbol', 'copyright', 'arrow', 'euro'],
      visible: (c) => c.can.edit,
      run: (c) => {
        if (c.editor) openChars(c.editor);
      }
    },
    { id: 'insert.rule', title: 'Insert a horizontal line', section: 'Insert', icon: minusIcon, keywords: ['divider', 'rule'], visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.setHorizontalRule()) },
    { id: 'insert.code', title: 'Insert a code block', section: 'Insert', icon: codeBlockIcon, visible: (c) => c.can.edit, run: (c) => run(c, (ch) => ch.toggleCodeBlock()) },
    { id: 'table.row-above', title: 'Add a table row above', section: 'Table', keywords: ['insert row'], visible: (c) => c.can.edit, disabled: (c) => !can(c, (e) => e.can().addRowBefore()), run: (c) => run(c, (ch) => ch.addRowBefore()) },
    { id: 'table.row-below', title: 'Add a table row below', section: 'Table', keywords: ['insert row'], visible: (c) => c.can.edit, disabled: (c) => !can(c, (e) => e.can().addRowAfter()), run: (c) => run(c, (ch) => ch.addRowAfter()) },
    { id: 'table.col-left', title: 'Add a table column left', section: 'Table', keywords: ['insert column'], visible: (c) => c.can.edit, disabled: (c) => !can(c, (e) => e.can().addColumnBefore()), run: (c) => run(c, (ch) => ch.addColumnBefore()) },
    { id: 'table.col-right', title: 'Add a table column right', section: 'Table', keywords: ['insert column'], visible: (c) => c.can.edit, disabled: (c) => !can(c, (e) => e.can().addColumnAfter()), run: (c) => run(c, (ch) => ch.addColumnAfter()) },
    { id: 'table.delete-row', title: 'Delete the table row', section: 'Table', visible: (c) => c.can.edit, disabled: (c) => !can(c, (e) => e.can().deleteRow()), run: (c) => run(c, (ch) => ch.deleteRow()) },
    { id: 'table.delete-col', title: 'Delete the table column', section: 'Table', visible: (c) => c.can.edit, disabled: (c) => !can(c, (e) => e.can().deleteColumn()), run: (c) => run(c, (ch) => ch.deleteColumn()) },
    { id: 'table.merge', title: 'Merge table cells', section: 'Table', visible: (c) => c.can.edit, disabled: (c) => !can(c, (e) => e.can().mergeCells()), run: (c) => run(c, (ch) => ch.mergeCells()) },
    { id: 'table.split', title: 'Split a table cell', section: 'Table', visible: (c) => c.can.edit, disabled: (c) => !can(c, (e) => e.can().splitCell()), run: (c) => run(c, (ch) => ch.splitCell()) },
    { id: 'table.header', title: 'Turn the header row on or off', section: 'Table', visible: (c) => c.can.edit, disabled: (c) => !can(c, (e) => e.can().toggleHeaderRow()), run: (c) => run(c, (ch) => ch.toggleHeaderRow()) },
    { id: 'table.delete', title: 'Delete the table', section: 'Table', visible: (c) => c.can.edit, disabled: (c) => !can(c, (e) => e.can().deleteTable()), run: (c) => run(c, (ch) => ch.deleteTable()) },

    { id: 'view.outline', title: 'Show the outline', section: 'View', icon: listMagnifyingGlassIcon, keywords: ['headings', 'navigation', 'contents'], run: (c) => c.panes.toggle('outline') },
    {
      id: 'view.word-count',
      title: 'Word count',
      section: 'View',
      icon: textAaIcon,
      keywords: ['characters', 'paragraphs', 'statistics'],
      run: (c) => {
        if (c.editor) openCount(c.editor);
      }
    }
  ],

  panes: [
    {
      id: 'outline',
      side: 'left',
      title: 'Outline',
      width: 260,
      render: (c) => <OutlinePane editor={c.editor} />
    }
  ],

  statusItems: [
    { id: 'status.words', side: 'left', order: 10, render: (c) => <WordCountStatus editor={c.editor} /> },
    { id: 'status.connection', side: 'left', order: 30, render: (c) => <ConnectionStatus ctx={c} /> },
    // Draws nothing in the footer: its panels are portalled into the shell (core/Host.tsx).
    { id: 'status.core-host', side: 'right', order: 1000, render: (c) => <CoreHost ctx={c} /> }
  ],

  fileItems: [
    { id: 'file.new', label: 'New', icon: filePlusIcon, section: 'Document', order: 100, visible: (c) => c.can.create, run: (c) => c.actions.newDocument('docs') },
    { id: 'file.open', label: 'Open', icon: folderOpenIcon, section: 'Document', order: 200, visible: (c) => c.source.kind !== 'local', run: (c) => c.actions.openHome() },
    { id: 'file.copy', label: 'Make a copy', icon: copyIcon, section: 'Document', order: 300, visible: (c) => c.can.copy, run: (c) => c.actions.copy() },
    { id: 'file.rename', label: 'Rename', icon: pencilSimpleIcon, section: 'Document', order: 400, visible: (c) => c.can.rename, run: (c) => c.actions.focusTitle() },
    { id: 'file.history', label: 'Version history', icon: clockCounterClockwiseIcon, section: 'Share', order: 500, visible: (c) => c.can.history, run: (c) => c.panes.open('history') },
    { id: 'file.share', label: 'Share', icon: usersIcon, section: 'Share', order: 510, visible: (c) => c.can.share, run: (c) => c.actions.share() },
    { id: 'file.lock', label: 'Lock with a password', icon: lockKeyIcon, section: 'Share', order: 520, visible: (c) => c.can.lock, run: (c) => c.actions.lock() },
    { id: 'file.unlock', label: 'Remove the password', icon: lockSimpleIcon, section: 'Share', order: 525, visible: (c) => c.can.unlock, run: (c) => c.actions.removePassword() },
    { id: 'file.print', label: 'Print', icon: printerIcon, shortcut: mod('P'), section: 'Export', order: 700, visible: (c) => c.can.print, run: (c) => c.actions.print() },
    { id: 'file.trash', label: 'Move to trash', icon: trashIcon, section: 'Danger', order: 900, danger: true, visible: (c) => c.can.trash, run: (c) => c.actions.trash() }
  ],

  modes: [
    { id: 'editing', label: 'Editing', icon: pencilSimpleIcon, order: 100 },
    { id: 'viewing', label: 'Viewing', icon: eyeIcon, order: 900 }
  ]
};
