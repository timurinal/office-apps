/**
 * The core module: what every presentation needs.
 *
 *   Home         undo and redo; cut, copy and paste; New slide (with the layouts), Layout and
 *                Reset; the font, its size, bold, italic, underline, strikethrough and colour;
 *                bullets, numbering, indent, alignment and line spacing
 *   Insert       New slide; Text box
 *   Slide show   From beginning and From current slide (only with a presenter); Hide slide
 *   View         Normal and each module's view; Notes; zoom and Fit
 *
 * And the File menu's rows, the commands the Ctrl+K box runs, the keys, the footer ("Slide 2 of
 * 6", the connection, Notes, the views, Fit) and the Editing and Viewing modes.
 *
 * What each button does is in `editor/actions.ts`, `editor/clipboard.ts` and `editor/format.ts`,
 * one function each with a test; this file says where it goes. A control that is off for a reader
 * is off by `can.edit`, never by a role.
 */

import {
  arrowCounterClockwiseIcon,
  arrowUUpLeftIcon,
  arrowUUpRightIcon,
  clipboardTextIcon,
  clockCounterClockwiseIcon,
  copyIcon,
  eyeIcon,
  eyeSlashIcon,
  filePlusIcon,
  folderOpenIcon,
  Icon,
  listBulletsIcon,
  listNumbersIcon,
  notePencilIcon,
  pencilSimpleIcon,
  sidebarSimpleIcon,
  squaresFourIcon,
  textAlignLeftIcon,
  textBIcon,
  textIndentIcon,
  textItalicIcon,
  textOutdentIcon,
  textStrikethroughIcon,
  textUnderlineIcon,
  trashIcon,
  usersIcon
} from '../../core/icons';
import { mod } from '../../core/keys';
import type { Command, FileItem, MenuEntry, RibbonGroup, RibbonItem, StatusItem } from '../../core/shell/types';
import { TEXT_COLORS } from '../../docs/core/colors';
import { FONT_CHOICES } from '../../docs/core/fonts';
import {
  chosenHidden,
  chosenLayout,
  deleteSlides,
  duplicate,
  duplicateSlides,
  insertTextBox,
  newSlide,
  resetSlides,
  selectAll,
  setLayout,
  toggleHidden,
  type Target
} from '../editor/actions';
import { copyPayload, encodeClip, pasteFrom, PICTURES_LEFT_OUT, readSystem, removeCopied, writeSystem, type ClipTarget } from '../editor/clipboard';
import type { MarkName } from '../editor/format';
import { LayoutButton, NewSlideButton } from '../editor/LayoutGallery';
import {
  arrowsDownUpIcon,
  cornersOutIcon,
  layoutIcon,
  magnifyingGlassMinusIcon,
  magnifyingGlassPlusIcon,
  playIcon,
  plusSquareIcon,
  scissorsIcon,
  selectionAllIcon,
  textAlignCenterIcon,
  textAlignJustifyIcon,
  textAlignRightIcon,
  textTIcon
} from './icons';
import type { Connection, SlidesContext, SlidesKey, SlidesModule } from './types';

// ── small helpers ───────────────────────────────────────────────────────────

const target = (c: SlidesContext): Target => ({ model: c.model, selection: c.selection });
const clip = (c: SlidesContext): ClipTarget => ({ model: c.model, selection: c.selection, doc: c.meta.id });

/** Everything that changes the deck is off for a reader, in the trash, in Viewing mode and in a preview. */
const cannotEdit = (c: SlidesContext): boolean => !c.can.edit;
/** Formatting needs text: a box with the caret, or a chosen shape. */
const cannotFormat = (c: SlidesContext): boolean => !c.can.edit || !c.text.available();

/** The keyboard back where it was (the slide, its text, or the slide list) after a button. */
const back = (c: SlidesContext): void => (c.selection.get().focus === 'rail' ? c.actions.focusRail() : c.actions.focusCanvas());
const then = (fn: (c: SlidesContext) => void) => (c: SlidesContext) => {
  fn(c);
  back(c);
};

/** Point sizes in the size menu: PowerPoint's. */
export const SLIDE_SIZES: readonly number[] = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];

const LINE_SPACING: readonly number[] = [1, 1.5, 2, 2.5, 3];

const ZOOM_STEP = 10;
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const zoomBy = (c: SlidesContext, delta: number): void => c.setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.zoom + delta)));

// ── the clipboard, from a button ────────────────────────────────────────────

/** Copy or cut what is chosen. A button has no copy event, so this goes through the async clipboard. */
export async function copyChosen(c: SlidesContext, cut: boolean): Promise<void> {
  const payload = copyPayload(clip(c));
  if (!payload) return;
  const ok = await writeSystem(encodeClip(payload));
  if (!ok) {
    c.notify({ text: `Use ${mod('C')} to copy here.` });
    return;
  }
  if (cut) removeCopied(clip(c), payload.kind);
}

export async function pasteChosen(c: SlidesContext): Promise<void> {
  const data = await readSystem();
  if (!data) {
    c.notify({ text: `Use ${mod('V')} to paste here.` });
    return;
  }
  const r = pasteFrom(clip(c), data);
  if (r?.droppedPictures) c.notify({ text: PICTURES_LEFT_OUT });
}

// ── the footer ──────────────────────────────────────────────────────────────

function SlideCount({ ctx }: { ctx: SlidesContext }) {
  const count = ctx.model.order().length;
  return <span className="oa-status">{count ? `Slide ${ctx.slideIndex + 1} of ${count}` : 'No slides'}</span>;
}

const CONNECTION: Record<Connection, { label: string; warn: boolean } | null> = {
  live: { label: 'Connected', warn: false },
  connecting: { label: 'Connecting', warn: true },
  offline: { label: 'Offline', warn: true },
  local: { label: 'On this device', warn: false },
  stopped: null
};

function ConnectionStatus({ ctx }: { ctx: SlidesContext }) {
  const c = CONNECTION[ctx.connection];
  if (!c) return null;
  return (
    <span className="oa-status" role="status" style={{ marginLeft: 12 }}>
      <span className="oa-dot" data-tone={c.warn ? 'warn' : undefined} />
      {c.label}
    </span>
  );
}

function NotesToggle({ ctx }: { ctx: SlidesContext }) {
  return (
    <button type="button" className="sl-sb" aria-pressed={ctx.notes.shown} onClick={() => ctx.notes.setShown(!ctx.notes.shown)}>
      <Icon icon={notePencilIcon} size={14} />
      Notes
    </button>
  );
}

const viewIcon = (id: string, icon: SlidesContext['views'][number]['icon']) => icon ?? (id === 'normal' ? sidebarSimpleIcon : squaresFourIcon);

function ViewSwitches({ ctx }: { ctx: SlidesContext }) {
  return (
    <span className="sl-sbs" role="group" aria-label="Views">
      {ctx.views.map((v) => (
        <button key={v.id} type="button" className="sl-sb" data-icon="" aria-label={v.label} title={v.label} aria-pressed={ctx.view === v.id} onClick={() => ctx.setView(v.id)}>
          <Icon icon={viewIcon(v.id, v.icon)} size={14} />
        </button>
      ))}
      {ctx.can.present && (
        <button type="button" className="sl-sb" data-icon="" aria-label="Slide show" title="Slide show" onClick={() => ctx.present(Math.max(0, ctx.slideIndex))}>
          <Icon icon={playIcon} size={14} />
        </button>
      )}
    </span>
  );
}

function FitButton({ ctx }: { ctx: SlidesContext }) {
  return (
    <button type="button" className="sl-sb" data-icon="" aria-label="Fit slide to window" title="Fit slide to window" aria-pressed={ctx.fit} onClick={() => ctx.setZoom('fit')}>
      <Icon icon={cornersOutIcon} size={14} />
    </button>
  );
}

// ── the ribbon ──────────────────────────────────────────────────────────────

const newSlideItem = (id: string): RibbonItem<SlidesContext> => ({
  type: 'custom',
  id,
  render: (c) => (
    <NewSlideButton
      id={id}
      label="New slide"
      icon={plusSquareIcon}
      shortcut={mod('M')}
      disabled={cannotEdit(c)}
      design={() => c.model.design()}
      current={() => null}
      run={() => {
        newSlide(target(c));
        back(c);
      }}
      onPick={(layout) => {
        newSlide(target(c), layout);
        back(c);
      }}
    />
  )
});

const markButton = (id: string, name: MarkName, label: string, icon: string, key?: string): RibbonItem<SlidesContext> => ({
  type: 'button',
  id,
  label,
  icon,
  shortcut: key ? mod(key) : undefined,
  active: (c) => c.text.mark(name),
  disabled: cannotFormat,
  run: (c) => c.text.toggleMark(name)
});

const ALIGN: { value: 'left' | 'center' | 'right' | 'justify'; label: string; icon: string; key: string }[] = [
  { value: 'left', label: 'Align left', icon: textAlignLeftIcon, key: 'L' },
  { value: 'center', label: 'Centre', icon: textAlignCenterIcon, key: 'E' },
  { value: 'right', label: 'Align right', icon: textAlignRightIcon, key: 'R' },
  { value: 'justify', label: 'Justify', icon: textAlignJustifyIcon, key: 'J' }
];

const lineSpacing: MenuEntry<SlidesContext>[] = LINE_SPACING.map((v) => ({
  label: v.toFixed(1),
  active: (c: SlidesContext) => c.text.lineHeight() === v,
  disabled: cannotFormat,
  run: (c: SlidesContext) => c.text.setParagraphs({ lineHeight: v })
}));

const ribbon: RibbonGroup<SlidesContext>[] = [
  // Home ─────────────────────────────────────────────────────────────────
  {
    id: 'home.history',
    tab: 'home',
    order: 100,
    label: 'Undo',
    items: [
      { type: 'button', id: 'home.undo', label: 'Undo', icon: arrowUUpLeftIcon, shortcut: mod('Z'), run: then((c) => void c.model.undo()), disabled: (c) => cannotEdit(c) || !c.model.canUndo() },
      { type: 'button', id: 'home.redo', label: 'Redo', icon: arrowUUpRightIcon, shortcut: mod('Y'), run: then((c) => void c.model.redo()), disabled: (c) => cannotEdit(c) || !c.model.canRedo() }
    ]
  },
  {
    id: 'home.clipboard',
    tab: 'home',
    order: 150,
    label: 'Clipboard',
    items: [
      { type: 'button', id: 'home.paste', label: 'Paste', icon: clipboardTextIcon, shortcut: mod('V'), showLabel: true, disabled: cannotEdit, run: then((c) => void pasteChosen(c)) },
      { type: 'button', id: 'home.cut', label: 'Cut', icon: scissorsIcon, shortcut: mod('X'), visible: (c) => c.can.download, disabled: cannotEdit, run: then((c) => void copyChosen(c, true)) },
      { type: 'button', id: 'home.copy', label: 'Copy', icon: copyIcon, shortcut: mod('C'), visible: (c) => c.can.download, run: then((c) => void copyChosen(c, false)) }
    ]
  },
  {
    id: 'home.slides',
    tab: 'home',
    order: 200,
    label: 'Slides',
    items: [
      newSlideItem('home.new-slide'),
      {
        type: 'custom',
        id: 'home.layout',
        render: (c) => (
          <LayoutButton
            id="home.layout"
            label="Layout"
            icon={layoutIcon}
            disabled={cannotEdit(c) || !c.slideId}
            design={() => c.model.design()}
            current={() => chosenLayout(target(c))}
            onPick={(layout) => {
              setLayout(target(c), layout);
              back(c);
            }}
          />
        )
      },
      { type: 'button', id: 'home.reset', label: 'Reset', icon: arrowCounterClockwiseIcon, showLabel: true, disabled: (c) => cannotEdit(c) || !c.slideId, run: then((c) => void resetSlides(target(c))) }
    ]
  },
  {
    id: 'home.font',
    tab: 'home',
    order: 300,
    label: 'Font',
    items: [
      { type: 'select', id: 'home.font-family', label: 'Font', width: 132, options: FONT_CHOICES, disabled: cannotFormat, value: (c) => c.text.fontFamily(), run: (c, v) => c.text.setStyle({ fontFamily: v }) },
      {
        type: 'select',
        id: 'home.font-size',
        label: 'Font size',
        width: 64,
        options: SLIDE_SIZES.map((n) => ({ value: String(n), label: String(n) })),
        disabled: cannotFormat,
        value: (c) => {
          const n = c.text.fontSize();
          return n === null ? '' : String(Math.round(n * 10) / 10);
        },
        run: (c, v) => c.text.setStyle({ fontSize: Number(v) })
      },
      markButton('home.bold', 'bold', 'Bold', textBIcon, 'B'),
      markButton('home.italic', 'italic', 'Italic', textItalicIcon, 'I'),
      markButton('home.underline', 'underline', 'Underline', textUnderlineIcon, 'U'),
      markButton('home.strike', 'strike', 'Strikethrough', textStrikethroughIcon),
      {
        type: 'color',
        id: 'home.color',
        label: 'Font colour',
        palette: TEXT_COLORS,
        glyph: 'A',
        clearLabel: 'Theme colour',
        disabled: cannotFormat,
        value: (c) => c.text.color(),
        run: (c, color) => c.text.setStyle({ color })
      }
    ]
  },
  {
    id: 'home.paragraph',
    tab: 'home',
    order: 400,
    label: 'Paragraph',
    items: [
      { type: 'button', id: 'home.bullets', label: 'Bullets', icon: listBulletsIcon, active: (c) => c.text.bullet() === 'char', disabled: cannotFormat, run: (c) => c.text.toggleBullets('char') },
      { type: 'button', id: 'home.numbering', label: 'Numbering', icon: listNumbersIcon, active: (c) => c.text.bullet() === 'number', disabled: cannotFormat, run: (c) => c.text.toggleBullets('number') },
      { type: 'button', id: 'home.outdent', label: 'Decrease list level', icon: textOutdentIcon, shortcut: 'Shift+Tab', disabled: cannotFormat, run: (c) => c.text.indent(-1) },
      { type: 'button', id: 'home.indent', label: 'Increase list level', icon: textIndentIcon, shortcut: 'Tab', disabled: cannotFormat, run: (c) => c.text.indent(1) },
      { type: 'separator', id: 'home.paragraph.sep' },
      ...ALIGN.map(
        (a): RibbonItem<SlidesContext> => ({
          type: 'button',
          id: `home.align-${a.value}`,
          label: a.label,
          icon: a.icon,
          shortcut: mod(a.key),
          active: (c) => c.text.align() === a.value,
          disabled: cannotFormat,
          run: (c) => c.text.setParagraphs({ align: a.value })
        })
      ),
      { type: 'menu', id: 'home.line-spacing', label: 'Line spacing', icon: arrowsDownUpIcon, disabled: cannotFormat, entries: lineSpacing }
    ]
  },

  // Insert ───────────────────────────────────────────────────────────────
  { id: 'insert.slides', tab: 'insert', order: 100, label: 'Slides', items: [newSlideItem('insert.new-slide')] },
  {
    id: 'insert.text',
    tab: 'insert',
    order: 500,
    label: 'Text',
    items: [{ type: 'button', id: 'insert.text-box', label: 'Text box', icon: textTIcon, showLabel: true, disabled: (c) => cannotEdit(c) || !c.slideId, run: (c) => void insertTextBox(target(c)) }]
  },

  // Slide show ───────────────────────────────────────────────────────────
  {
    id: 'slideshow.start',
    tab: 'slideshow',
    order: 100,
    label: 'Start slide show',
    items: [
      { type: 'button', id: 'slideshow.from-start', label: 'From beginning', icon: playIcon, shortcut: 'F5', showLabel: true, visible: (c) => c.can.present, run: (c) => c.present(0) },
      { type: 'button', id: 'slideshow.from-current', label: 'From current slide', icon: playIcon, shortcut: 'Shift+F5', showLabel: true, visible: (c) => c.can.present, run: (c) => c.present(Math.max(0, c.slideIndex)) }
    ]
  },
  {
    id: 'slideshow.setup',
    tab: 'slideshow',
    order: 200,
    label: 'Set up',
    items: [
      { type: 'button', id: 'slideshow.hide', label: 'Hide slide', icon: eyeSlashIcon, showLabel: true, active: (c) => chosenHidden(target(c)), disabled: (c) => cannotEdit(c) || !c.slideId, run: then((c) => void toggleHidden(target(c))) }
    ]
  },

  // View ─────────────────────────────────────────────────────────────────
  {
    id: 'view.views',
    tab: 'view',
    order: 100,
    label: 'Views',
    items: [
      {
        type: 'custom',
        id: 'view.views',
        render: (c) => (
          <>
            {c.views.map((v) => (
              <button
                key={v.id}
                type="button"
                data-rb-item
                data-id={`view.${v.id}`}
                className="oa-rb-tl"
                title={v.label}
                aria-pressed={c.view === v.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => c.setView(v.id)}
              >
                <Icon icon={viewIcon(v.id, v.icon)} size={16} />
                {v.label}
              </button>
            ))}
          </>
        )
      }
    ]
  },
  {
    id: 'view.show',
    tab: 'view',
    order: 200,
    label: 'Show',
    items: [{ type: 'button', id: 'view.notes', label: 'Notes', icon: notePencilIcon, showLabel: true, active: (c) => c.notes.shown, run: (c) => c.notes.setShown(!c.notes.shown) }]
  },
  {
    id: 'view.zoom',
    tab: 'view',
    order: 300,
    label: 'Zoom',
    items: [
      { type: 'button', id: 'view.zoom-out', label: 'Zoom out', icon: magnifyingGlassMinusIcon, run: (c) => zoomBy(c, -ZOOM_STEP), disabled: (c) => c.zoom <= ZOOM_MIN },
      { type: 'button', id: 'view.zoom-in', label: 'Zoom in', icon: magnifyingGlassPlusIcon, run: (c) => zoomBy(c, ZOOM_STEP), disabled: (c) => c.zoom >= ZOOM_MAX },
      { type: 'button', id: 'view.zoom-100', label: '100%', showLabel: true, run: (c) => c.setZoom(100), disabled: (c) => !c.fit && c.zoom === 100 },
      { type: 'button', id: 'view.fit', label: 'Fit', icon: cornersOutIcon, showLabel: true, active: (c) => c.fit, run: (c) => c.setZoom('fit') }
    ]
  }
];

// ── the command box ─────────────────────────────────────────────────────────

const commands: Command<SlidesContext>[] = [
  { id: 'file.new', title: 'New presentation', section: 'File', icon: filePlusIcon, keywords: ['create', 'blank', 'powerpoint', 'deck'], visible: (c) => c.can.create, run: (c) => c.actions.newDocument('slides') },
  { id: 'file.new-document', title: 'New document', section: 'File', icon: filePlusIcon, keywords: ['create', 'word'], visible: (c) => c.can.create, run: (c) => c.actions.newDocument('docs') },
  { id: 'file.new-sheet', title: 'New spreadsheet', section: 'File', icon: filePlusIcon, keywords: ['create', 'excel'], visible: (c) => c.can.create, run: (c) => c.actions.newDocument('sheets') },
  { id: 'file.open', title: 'Open another document', section: 'File', icon: folderOpenIcon, keywords: ['home', 'recent'], visible: (c) => c.source.kind !== 'local', run: (c) => c.actions.openHome() },
  { id: 'file.copy', title: 'Make a copy', section: 'File', icon: copyIcon, keywords: ['duplicate'], visible: (c) => c.can.copy, run: (c) => c.actions.copy() },
  { id: 'file.rename', title: 'Rename', section: 'File', icon: pencilSimpleIcon, keywords: ['title'], visible: (c) => c.can.rename, run: (c) => c.actions.focusTitle() },
  { id: 'file.share', title: 'Share', section: 'File', icon: usersIcon, keywords: ['invite', 'link', 'permissions'], visible: (c) => c.can.share, run: (c) => c.actions.share() },
  { id: 'file.history', title: 'Version history', section: 'File', icon: clockCounterClockwiseIcon, keywords: ['restore', 'versions', 'earlier'], visible: (c) => c.can.history, run: (c) => c.panes.open('history') },
  { id: 'file.trash', title: 'Move to trash', section: 'File', icon: trashIcon, keywords: ['delete'], visible: (c) => c.can.trash, run: (c) => c.actions.trash() },

  { id: 'edit.undo', title: 'Undo', section: 'Edit', icon: arrowUUpLeftIcon, shortcut: mod('Z'), visible: (c) => c.can.edit, disabled: (c) => !c.model.canUndo(), run: (c) => void c.model.undo() },
  { id: 'edit.redo', title: 'Redo', section: 'Edit', icon: arrowUUpRightIcon, shortcut: mod('Y'), visible: (c) => c.can.edit, disabled: (c) => !c.model.canRedo(), run: (c) => void c.model.redo() },
  { id: 'edit.cut', title: 'Cut', section: 'Edit', icon: scissorsIcon, shortcut: mod('X'), visible: (c) => c.can.edit && c.can.download, run: (c) => void copyChosen(c, true) },
  { id: 'edit.copy', title: 'Copy', section: 'Edit', icon: copyIcon, shortcut: mod('C'), visible: (c) => c.can.download, run: (c) => void copyChosen(c, false) },
  { id: 'edit.paste', title: 'Paste', section: 'Edit', icon: clipboardTextIcon, shortcut: mod('V'), visible: (c) => c.can.edit, run: (c) => void pasteChosen(c) },
  { id: 'edit.duplicate', title: 'Duplicate', section: 'Edit', icon: copyIcon, shortcut: mod('D'), visible: (c) => c.can.edit, run: (c) => duplicate(target(c)) },
  { id: 'edit.select-all', title: 'Select all', section: 'Edit', icon: selectionAllIcon, shortcut: mod('A'), run: (c) => selectAll(target(c)) },

  { id: 'slide.new', title: 'New slide', section: 'Slide', icon: plusSquareIcon, shortcut: mod('M'), keywords: ['add slide'], visible: (c) => c.can.edit, run: (c) => void newSlide(target(c)) },
  { id: 'slide.duplicate', title: 'Duplicate slide', section: 'Slide', icon: copyIcon, keywords: ['copy slide'], visible: (c) => c.can.edit && !!c.slideId, run: (c) => void duplicateSlides(target(c)) },
  { id: 'slide.delete', title: 'Delete slide', section: 'Slide', icon: trashIcon, keywords: ['remove slide'], visible: (c) => c.can.edit && !!c.slideId, run: (c) => void deleteSlides(target(c)) },
  { id: 'slide.hide', title: 'Hide or show slide', section: 'Slide', icon: eyeSlashIcon, keywords: ['skip'], visible: (c) => c.can.edit && !!c.slideId, run: (c) => void toggleHidden(target(c)) },
  { id: 'slide.reset', title: 'Reset slide', section: 'Slide', icon: arrowCounterClockwiseIcon, keywords: ['layout', 'placeholders'], visible: (c) => c.can.edit && !!c.slideId, run: (c) => void resetSlides(target(c)) },
  ...(['title', 'titleContent', 'blank'] as const).map(
    (id): Command<SlidesContext> => ({
      id: `slide.layout-${id}`,
      title: `Layout: ${{ title: 'Title slide', titleContent: 'Title and content', blank: 'Blank' }[id]}`,
      section: 'Slide',
      icon: layoutIcon,
      visible: (c) => c.can.edit && !!c.slideId && c.design.layouts.some((l) => l.id === id),
      run: (c) => void setLayout(target(c), id)
    })
  ),

  { id: 'insert.text-box', title: 'Text box', section: 'Insert', icon: textTIcon, keywords: ['text', 'label'], visible: (c) => c.can.edit && !!c.slideId, run: (c) => void insertTextBox(target(c)) },

  { id: 'format.bold', title: 'Bold', section: 'Format', icon: textBIcon, shortcut: mod('B'), visible: (c) => c.can.edit, disabled: (c) => !c.text.available(), run: (c) => c.text.toggleMark('bold') },
  { id: 'format.italic', title: 'Italic', section: 'Format', icon: textItalicIcon, shortcut: mod('I'), visible: (c) => c.can.edit, disabled: (c) => !c.text.available(), run: (c) => c.text.toggleMark('italic') },
  { id: 'format.underline', title: 'Underline', section: 'Format', icon: textUnderlineIcon, shortcut: mod('U'), visible: (c) => c.can.edit, disabled: (c) => !c.text.available(), run: (c) => c.text.toggleMark('underline') },
  { id: 'format.strike', title: 'Strikethrough', section: 'Format', icon: textStrikethroughIcon, visible: (c) => c.can.edit, disabled: (c) => !c.text.available(), run: (c) => c.text.toggleMark('strike') },
  { id: 'format.bullets', title: 'Bullets', section: 'Format', icon: listBulletsIcon, keywords: ['list'], visible: (c) => c.can.edit, disabled: (c) => !c.text.available(), run: (c) => c.text.toggleBullets('char') },
  { id: 'format.numbering', title: 'Numbering', section: 'Format', icon: listNumbersIcon, keywords: ['list', 'numbered'], visible: (c) => c.can.edit, disabled: (c) => !c.text.available(), run: (c) => c.text.toggleBullets('number') },
  ...ALIGN.map(
    (a): Command<SlidesContext> => ({
      id: `format.align-${a.value}`,
      title: a.label,
      section: 'Format',
      icon: a.icon,
      keywords: ['align', 'alignment'],
      visible: (c) => c.can.edit,
      disabled: (c) => !c.text.available(),
      run: (c) => c.text.setParagraphs({ align: a.value })
    })
  ),

  { id: 'view.normal', title: 'Normal view', section: 'View', icon: sidebarSimpleIcon, run: (c) => c.setView('normal') },
  { id: 'view.notes', title: 'Show or hide notes', section: 'View', icon: notePencilIcon, keywords: ['speaker notes'], run: (c) => c.notes.setShown(!c.notes.shown) },
  { id: 'view.zoom-in', title: 'Zoom in', section: 'View', icon: magnifyingGlassPlusIcon, disabled: (c) => c.zoom >= ZOOM_MAX, run: (c) => zoomBy(c, ZOOM_STEP) },
  { id: 'view.zoom-out', title: 'Zoom out', section: 'View', icon: magnifyingGlassMinusIcon, disabled: (c) => c.zoom <= ZOOM_MIN, run: (c) => zoomBy(c, -ZOOM_STEP) },
  { id: 'view.fit', title: 'Fit slide to window', section: 'View', icon: cornersOutIcon, keywords: ['zoom'], run: (c) => c.setZoom('fit') },

  { id: 'show.from-start', title: 'Slide show from the beginning', section: 'View', icon: playIcon, shortcut: 'F5', keywords: ['present', 'play'], visible: (c) => c.can.present, run: (c) => c.present(0) },
  { id: 'show.from-current', title: 'Slide show from this slide', section: 'View', icon: playIcon, shortcut: 'Shift+F5', keywords: ['present', 'play'], visible: (c) => c.can.present, run: (c) => c.present(Math.max(0, c.slideIndex)) }
];

// ── the keys ────────────────────────────────────────────────────────────────

const formatKey = (keys: string, name: MarkName): SlidesKey => ({ keys, when: (c) => c.can.edit && c.text.available(), run: (c) => c.text.toggleMark(name) });

const keys: SlidesKey[] = [
  { keys: 'Mod+Z', when: (c) => c.can.edit, run: (c) => void c.model.undo() },
  { keys: 'Mod+Shift+Z', when: (c) => c.can.edit, run: (c) => void c.model.redo() },
  { keys: 'Mod+Y', when: (c) => c.can.edit, run: (c) => void c.model.redo() },
  { keys: 'Mod+M', when: (c) => c.can.edit, run: (c) => void newSlide(target(c)) },
  { keys: 'Mod+D', when: (c) => c.can.edit, run: (c) => duplicate(target(c)) },
  { keys: 'Mod+A', run: (c) => selectAll(target(c)) },
  formatKey('Mod+B', 'bold'),
  formatKey('Mod+I', 'italic'),
  formatKey('Mod+U', 'underline'),
  { keys: 'Mod+/', run: (c) => c.actions.focusPalette() },
  { keys: 'F5', when: (c) => c.can.present, run: (c) => c.present(0) },
  { keys: 'Shift+F5', when: (c) => c.can.present, run: (c) => c.present(Math.max(0, c.slideIndex)) }
];

// ── the footer's items, the File menu, the modes ────────────────────────────

const statusItems: StatusItem<SlidesContext>[] = [
  { id: 'status.slide', side: 'left', order: 10, render: (c) => <SlideCount ctx={c} /> },
  { id: 'status.connection', side: 'left', order: 20, render: (c) => <ConnectionStatus ctx={c} /> },
  { id: 'status.notes', side: 'right', order: 10, visible: (c) => c.view === 'normal', render: (c) => <NotesToggle ctx={c} /> },
  { id: 'status.views', side: 'right', order: 20, render: (c) => <ViewSwitches ctx={c} /> },
  { id: 'status.fit', side: 'right', order: 30, render: (c) => <FitButton ctx={c} /> }
];

const fileItems: FileItem<SlidesContext>[] = [
  { id: 'file.new', label: 'New', icon: filePlusIcon, section: 'Document', order: 100, visible: (c) => c.can.create, run: (c) => c.actions.newDocument('slides') },
  { id: 'file.open', label: 'Open', icon: folderOpenIcon, section: 'Document', order: 200, visible: (c) => c.source.kind !== 'local', run: (c) => c.actions.openHome() },
  { id: 'file.copy', label: 'Make a copy', icon: copyIcon, section: 'Document', order: 300, visible: (c) => c.can.copy, run: (c) => c.actions.copy() },
  { id: 'file.rename', label: 'Rename', icon: pencilSimpleIcon, section: 'Document', order: 400, visible: (c) => c.can.rename, run: (c) => c.actions.focusTitle() },
  { id: 'file.history', label: 'Version history', icon: clockCounterClockwiseIcon, section: 'Share', order: 500, visible: (c) => c.can.history, run: (c) => c.panes.open('history') },
  { id: 'file.share', label: 'Share', icon: usersIcon, section: 'Share', order: 510, visible: (c) => c.can.share, run: (c) => c.actions.share() },
  { id: 'file.trash', label: 'Move to trash', icon: trashIcon, section: 'Danger', order: 900, danger: true, visible: (c) => c.can.trash, run: (c) => c.actions.trash() }
];

export const coreModule: SlidesModule = {
  id: 'core',
  ribbon,
  commands,
  keys,
  statusItems,
  fileItems,
  modes: [
    { id: 'editing', label: 'Editing', icon: pencilSimpleIcon, order: 100 },
    { id: 'viewing', label: 'Viewing', icon: eyeIcon, order: 900 }
  ]
};
