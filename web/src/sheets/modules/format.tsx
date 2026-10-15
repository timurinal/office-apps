/**
 * The format module: what makes a sheet look like something.
 *
 *   Home  Font 200       painter, family, size, bold, italic, underline, strikethrough, borders, fill, text colour
 *         Alignment 300  align, indent, wrap, merge
 *         Number 400     the format, currency, percent, thousands, decimals
 *         Styles 500     conditional formatting, cell styles, clear formats
 *
 * and the conditional-format rules pane, the keys for bold, italic, underline and strikethrough, and
 * the commands the Ctrl+K box runs. What each button does is in `formatActions.ts` and
 * `conditionalActions.ts`, one function each with a test; the panel, gallery and menu controls are in
 * `ribbonControls.tsx`.
 *
 * Every control is disabled by `can.edit`, never by a role, and shows the active cell's state: it
 * is what the grid draws there, so a cell that is bold because its column is shows bold.
 */

import { Suspense, lazy } from 'react';
import {
  paintBucketIcon,
  textBIcon,
  textIndentIcon,
  textItalicIcon,
  textOutdentIcon,
  textStrikethroughIcon,
  textUnderlineIcon
} from '../../core/icons';
import { mod } from '../../core/keys';
import type { Command, MenuEntry, RibbonGroup } from '../../core/shell/types';
import { SkeletonRows } from '../../core/ui';
import { openTool } from '../panes/tools';
import { addQuick, clearRules } from './conditionalActions';
import {
  type BorderPreset,
  type Toggle,
  CELL_STYLES,
  activeStyle,
  alignH,
  alignV,
  applyBorders,
  applyCategory,
  applyCellStyle,
  applyCurrency,
  categoryNow,
  clearFormats,
  indent,
  merge,
  moreDecimals,
  setColor,
  setFont,
  toggle,
  togglePercent,
  toggleThousands
} from './formatActions';
import {
  alignBottomIcon,
  alignCenterVerticalIcon,
  alignTopIcon,
  arrowElbowDownLeftIcon,
  arrowsMergeIcon,
  arrowsSplitIcon,
  chartBarHorizontalIcon,
  commaIcon,
  fewerDecimalsIcon,
  moreDecimalsIcon,
  percentGlyphIcon,
  poundIcon,
  swatchesIcon,
  textAlignCenterIcon,
  textAlignLeftIcon,
  textAlignRightIcon,
  textTSlashIcon
} from './formatIcons';
import { CURRENCIES, DEFAULT_CURRENCY, FORMATS, hasThousands, type FormatId } from './numfmt';
import { FILL_COLORS, FONT_CHOICES, TEXT_COLORS } from './palettes';
import { BordersButton, CellStylesButton, ConditionalButton, PainterButton, SizeBox } from './ribbonControls';
import type { SheetsContext, SheetsKey, SheetsModule } from './types';

const CfManager = lazy(() => import('../panes/CfManager'));

const cannotEdit = (c: SheetsContext): boolean => !c.can.edit;

/** A command, then the keyboard back on the grid: a button must not leave the person's typing nowhere. */
const then = (fn: (c: SheetsContext) => void) => (c: SheetsContext) => {
  fn(c);
  c.actions.focusGrid();
};

/** The toggles: what each is called, its key, and the words the command box matches. */
const TOGGLES: { key: Toggle; label: string; icon: string; shortcut?: string; words: string[] }[] = [
  { key: 'bold', label: 'Bold', icon: textBIcon, shortcut: mod('B'), words: ['strong', 'weight'] },
  { key: 'italic', label: 'Italic', icon: textItalicIcon, shortcut: mod('I'), words: ['slant', 'emphasis'] },
  { key: 'underline', label: 'Underline', icon: textUnderlineIcon, shortcut: mod('U'), words: ['line'] },
  { key: 'strike', label: 'Strikethrough', icon: textStrikethroughIcon, shortcut: mod('Shift+X'), words: ['cross out'] }
];

const ALIGN_H = [
  { id: 'left', label: 'Align left', icon: textAlignLeftIcon },
  { id: 'center', label: 'Centre', icon: textAlignCenterIcon },
  { id: 'right', label: 'Align right', icon: textAlignRightIcon }
] as const;

const ALIGN_V = [
  { id: 'top', label: 'Align top', icon: alignTopIcon },
  { id: 'middle', label: 'Align middle', icon: alignCenterVerticalIcon },
  { id: 'bottom', label: 'Align bottom', icon: alignBottomIcon }
] as const;

/** The currency in use: the last chosen, for the button and for the dropdown's Currency. */
let currency = DEFAULT_CURRENCY;
try {
  const saved = localStorage.getItem('office.sheets.currency');
  if (saved && CURRENCIES.some((c) => c.symbol === saved)) currency = saved;
} catch {
  // Storage may be blocked; the pound is the default and nothing depends on remembering it.
}
const chooseCurrency = (c: SheetsContext, symbol: string): void => {
  currency = symbol;
  try {
    localStorage.setItem('office.sheets.currency', symbol);
  } catch {
    // As above.
  }
  applyCurrency(c, symbol);
};

const NUMBER_OPTIONS = [...FORMATS.map((f) => ({ value: f.id as string, label: f.label })), { value: 'custom', label: 'Custom' }];

const alignEntries: MenuEntry<SheetsContext>[] = [
  ...ALIGN_H.map((a): MenuEntry<SheetsContext> => ({ label: a.label, run: then((c) => alignH(c, a.id)), active: (c) => (activeStyle(c).h ?? 'general') === a.id, disabled: cannotEdit })),
  ...ALIGN_V.map(
    (a, i): MenuEntry<SheetsContext> => ({
      label: a.label,
      run: then((c) => alignV(c, a.id)),
      active: (c) => (activeStyle(c).v ?? 'middle') === a.id,
      disabled: cannotEdit,
      ...(i === 0 ? { separated: true } : {})
    })
  ),
  { label: 'Increase indent', icon: textIndentIcon, run: then((c) => indent(c, 1)), disabled: cannotEdit, separated: true },
  { label: 'Decrease indent', icon: textOutdentIcon, run: then((c) => indent(c, -1)), disabled: (c) => !c.can.edit || (activeStyle(c).indent ?? 0) === 0 }
];

const mergeEntries: MenuEntry<SheetsContext>[] = [
  { label: 'Merge and centre', icon: arrowsMergeIcon, run: then((c) => merge(c, 'centre')), disabled: cannotEdit },
  { label: 'Merge across', run: then((c) => merge(c, 'across')), disabled: cannotEdit },
  { label: 'Merge cells', run: then((c) => merge(c, 'cells')), disabled: cannotEdit },
  { label: 'Unmerge cells', icon: arrowsSplitIcon, run: then((c) => merge(c, 'unmerge')), disabled: cannotEdit, separated: true }
];

// ── the ribbon ──────────────────────────────────────────────────────────────

const ribbon: RibbonGroup<SheetsContext>[] = [
  {
    id: 'home.font',
    tab: 'home',
    order: 200,
    label: 'Font',
    items: [
      { type: 'custom', id: 'home.painter', render: (c) => <PainterButton ctx={c} /> },
      {
        type: 'select',
        id: 'home.font-family',
        label: 'Font',
        width: 112,
        options: FONT_CHOICES,
        value: (c) => activeStyle(c).font ?? 'Inter',
        run: (c, v) => {
          setFont(c, v);
          c.actions.focusGrid();
        },
        disabled: cannotEdit
      },
      { type: 'custom', id: 'home.size', render: (c) => <SizeBox ctx={c} /> },
      ...TOGGLES.map((t) => ({
        type: 'button' as const,
        id: `home.${t.key}`,
        label: t.label,
        icon: t.icon,
        ...(t.shortcut ? { shortcut: t.shortcut } : {}),
        active: (c: SheetsContext) => activeStyle(c)[t.key] === true,
        run: then((c) => toggle(c, t.key)),
        disabled: cannotEdit
      })),
      { type: 'custom', id: 'home.borders', render: (c) => <BordersButton ctx={c} /> },
      {
        type: 'color',
        id: 'home.fill',
        label: 'Fill colour',
        icon: paintBucketIcon,
        palette: FILL_COLORS,
        clearLabel: 'No fill',
        value: (c) => activeStyle(c).fill ?? '#e4e7f5',
        run: (c, colour) => {
          setColor(c, 'fill', colour);
          c.actions.focusGrid();
        },
        disabled: cannotEdit
      },
      {
        type: 'color',
        id: 'home.text-color',
        label: 'Text colour',
        glyph: 'A',
        palette: TEXT_COLORS,
        clearLabel: 'Automatic',
        value: (c) => activeStyle(c).color ?? null,
        run: (c, colour) => {
          setColor(c, 'color', colour);
          c.actions.focusGrid();
        },
        disabled: cannotEdit
      }
    ]
  },
  {
    id: 'home.alignment',
    tab: 'home',
    order: 300,
    label: 'Alignment',
    items: [
      { type: 'menu', id: 'home.align', label: 'Align', icon: textAlignLeftIcon, entries: alignEntries, disabled: cannotEdit },
      { type: 'button', id: 'home.wrap', label: 'Wrap text', icon: arrowElbowDownLeftIcon, active: (c) => activeStyle(c).wrap === true, run: then((c) => toggle(c, 'wrap')), disabled: cannotEdit },
      { type: 'menu', id: 'home.merge', label: 'Merge', icon: arrowsMergeIcon, entries: mergeEntries, disabled: cannotEdit }
    ]
  },
  {
    id: 'home.number',
    tab: 'home',
    order: 400,
    label: 'Number',
    items: [
      {
        type: 'select',
        id: 'home.number-format',
        label: 'Number format',
        width: 108,
        options: NUMBER_OPTIONS,
        value: categoryNow,
        run: (c, v) => {
          if (v === 'custom') openTool({ id: 'numfmt' });
          else {
            applyCategory(c, v as FormatId, currency);
            c.actions.focusGrid();
          }
        },
        disabled: cannotEdit
      },
      {
        type: 'split',
        id: 'home.currency',
        label: 'Currency',
        icon: poundIcon,
        run: then((c) => applyCurrency(c, currency)),
        disabled: cannotEdit,
        menu: CURRENCIES.map((cur) => ({ label: `${cur.symbol}  ${cur.name}`, run: then((c) => chooseCurrency(c, cur.symbol)), disabled: cannotEdit }))
      },
      { type: 'button', id: 'home.percent', label: 'Percent', icon: percentGlyphIcon, shortcut: mod('Shift+%'), active: (c) => categoryNow(c) === 'percent', run: then(togglePercent), disabled: cannotEdit },
      { type: 'button', id: 'home.thousands', label: 'Thousands separator', icon: commaIcon, active: (c) => hasThousands(activeStyle(c).numFmt) && categoryNow(c) === 'number', run: then(toggleThousands), disabled: cannotEdit },
      { type: 'button', id: 'home.more-decimals', label: 'More decimal places', icon: moreDecimalsIcon, run: then((c) => moreDecimals(c, 1)), disabled: cannotEdit },
      { type: 'button', id: 'home.fewer-decimals', label: 'Fewer decimal places', icon: fewerDecimalsIcon, run: then((c) => moreDecimals(c, -1)), disabled: cannotEdit }
    ]
  },
  {
    id: 'home.styles',
    tab: 'home',
    order: 500,
    label: 'Styles',
    items: [
      { type: 'custom', id: 'home.conditional', render: (c) => <ConditionalButton ctx={c} /> },
      { type: 'custom', id: 'home.cell-styles', render: (c) => <CellStylesButton ctx={c} /> }
    ]
  }
];

// ── the command box ─────────────────────────────────────────────────────────

const edit = (c: SheetsContext): boolean => c.can.edit;

const BORDER_COMMANDS: { id: BorderPreset; title: string }[] = [
  { id: 'all', title: 'All borders' },
  { id: 'outside', title: 'Outside borders' },
  { id: 'thick-outside', title: 'Thick outside borders' },
  { id: 'bottom', title: 'Bottom border' },
  { id: 'top', title: 'Top border' },
  { id: 'none', title: 'Remove borders' }
];

const commands: Command<SheetsContext>[] = [
  ...TOGGLES.map(
    (t): Command<SheetsContext> => ({
      id: `format.${t.key}`,
      title: t.label,
      section: 'Format',
      icon: t.icon,
      ...(t.shortcut ? { shortcut: t.shortcut } : {}),
      keywords: t.words,
      visible: edit,
      run: (c) => toggle(c, t.key)
    })
  ),
  { id: 'format.wrap', title: 'Wrap text', section: 'Format', icon: arrowElbowDownLeftIcon, keywords: ['line break', 'overflow'], visible: edit, run: (c) => toggle(c, 'wrap') },
  ...ALIGN_H.map((a): Command<SheetsContext> => ({ id: `format.align-${a.id}`, title: a.label, section: 'Format', icon: a.icon, keywords: ['alignment', 'text'], visible: edit, run: (c) => alignH(c, a.id) })),
  ...ALIGN_V.map((a): Command<SheetsContext> => ({ id: `format.valign-${a.id}`, title: a.label, section: 'Format', icon: a.icon, keywords: ['alignment', 'vertical'], visible: edit, run: (c) => alignV(c, a.id) })),
  { id: 'format.indent', title: 'Increase indent', section: 'Format', icon: textIndentIcon, visible: edit, run: (c) => indent(c, 1) },
  { id: 'format.outdent', title: 'Decrease indent', section: 'Format', icon: textOutdentIcon, visible: edit, run: (c) => indent(c, -1) },
  { id: 'format.merge-centre', title: 'Merge and centre', section: 'Format', icon: arrowsMergeIcon, keywords: ['merge cells', 'combine'], visible: edit, run: (c) => merge(c, 'centre') },
  { id: 'format.merge-across', title: 'Merge across', section: 'Format', icon: arrowsMergeIcon, keywords: ['merge cells', 'rows'], visible: edit, run: (c) => merge(c, 'across') },
  { id: 'format.merge', title: 'Merge cells', section: 'Format', icon: arrowsMergeIcon, keywords: ['combine'], visible: edit, run: (c) => merge(c, 'cells') },
  { id: 'format.unmerge', title: 'Unmerge cells', section: 'Format', icon: arrowsSplitIcon, keywords: ['split'], visible: edit, run: (c) => merge(c, 'unmerge') },

  ...FORMATS.filter((f) => f.id !== 'currency').map(
    (f): Command<SheetsContext> => ({ id: `format.number-${f.id}`, title: `Format as ${f.label.toLowerCase()}`, section: 'Format', keywords: ['number format', f.label.toLowerCase()], visible: edit, run: (c) => applyCategory(c, f.id, currency) })
  ),
  ...CURRENCIES.map(
    (cur): Command<SheetsContext> => ({ id: `format.currency-${cur.symbol}`, title: `Format as currency, ${cur.name.toLowerCase()} ${cur.symbol}`, section: 'Format', icon: poundIcon, keywords: ['money', 'currency', cur.name.toLowerCase()], visible: edit, run: (c) => chooseCurrency(c, cur.symbol) })
  ),
  { id: 'format.percent', title: 'Show as percent', section: 'Format', icon: percentGlyphIcon, keywords: ['percentage'], visible: edit, run: togglePercent },
  { id: 'format.thousands', title: 'Thousands separator', section: 'Format', icon: commaIcon, keywords: ['comma'], visible: edit, run: toggleThousands },
  { id: 'format.more-decimals', title: 'More decimal places', section: 'Format', icon: moreDecimalsIcon, keywords: ['increase decimals'], visible: edit, run: (c) => moreDecimals(c, 1) },
  { id: 'format.fewer-decimals', title: 'Fewer decimal places', section: 'Format', icon: fewerDecimalsIcon, keywords: ['decrease decimals'], visible: edit, run: (c) => moreDecimals(c, -1) },
  { id: 'format.number-more', title: 'More number formats', section: 'Format', keywords: ['custom format', 'format code', 'date format'], visible: edit, run: () => openTool({ id: 'numfmt' }) },

  ...BORDER_COMMANDS.map((b): Command<SheetsContext> => ({ id: `format.border-${b.id}`, title: b.title, section: 'Format', keywords: ['border', 'lines', 'box'], visible: edit, run: (c) => applyBorders(c, b.id, { line: b.id === 'thick-outside' ? 'thick' : 'thin' }) })),
  { id: 'format.clear', title: 'Clear formats', section: 'Format', icon: textTSlashIcon, keywords: ['reset', 'remove formatting'], visible: edit, run: clearFormats },
  ...CELL_STYLES.map((s): Command<SheetsContext> => ({ id: `format.style-${s.id}`, title: `Cell style: ${s.label}`, section: 'Format', icon: swatchesIcon, keywords: ['styles', 'good', 'bad', 'heading'], visible: edit, run: (c) => applyCellStyle(c, s.id) })),

  { id: 'cf.new', title: 'New conditional formatting rule', section: 'Format', icon: chartBarHorizontalIcon, keywords: ['highlight', 'rule', 'colour scale', 'data bars'], visible: edit, run: () => openTool({ id: 'cf' }) },
  { id: 'cf.manage', title: 'Manage conditional formatting', section: 'Format', icon: chartBarHorizontalIcon, keywords: ['rules', 'highlight'], run: (c) => c.panes.open('cf-rules') },
  { id: 'cf.duplicates', title: 'Highlight duplicate values', section: 'Format', icon: chartBarHorizontalIcon, keywords: ['conditional formatting', 'repeated'], visible: edit, run: (c) => void addQuick(c, { kind: 'duplicate' }) },
  { id: 'cf.above-average', title: 'Highlight values above average', section: 'Format', icon: chartBarHorizontalIcon, keywords: ['conditional formatting'], visible: edit, run: (c) => void addQuick(c, { kind: 'average' }) },
  { id: 'cf.clear-selection', title: 'Clear conditional formatting from the selection', section: 'Format', keywords: ['rules', 'remove'], visible: edit, run: (c) => void clearRules(c, 'selection') },
  { id: 'cf.clear-sheet', title: 'Clear conditional formatting from the sheet', section: 'Format', keywords: ['rules', 'remove'], visible: edit, run: (c) => void clearRules(c, 'sheet') }
];

// ── the keys ────────────────────────────────────────────────────────────────

const keys: SheetsKey[] = [
  { keys: 'Mod+B', when: edit, run: (c) => toggle(c, 'bold') },
  { keys: 'Mod+I', when: edit, run: (c) => toggle(c, 'italic') },
  { keys: 'Mod+U', when: edit, run: (c) => toggle(c, 'underline') },
  { keys: 'Mod+Shift+X', when: edit, run: (c) => toggle(c, 'strike') },
  { keys: 'Mod+Shift+%', when: edit, run: (c) => togglePercent(c) }
];

/** The rules pane, loaded when it is first opened. */
const panes: NonNullable<SheetsModule['panes']> = [
  {
    id: 'cf-rules',
    side: 'right',
    title: 'Conditional formatting',
    width: 340,
    render: (c) => (
      <Suspense fallback={<SkeletonRows />}>
        <CfManager ctx={c} />
      </Suspense>
    )
  }
];

export const formatModule: SheetsModule = { id: 'format', ribbon, commands, keys, panes };
