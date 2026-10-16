/**
 * The rows of a document's right-click menu, over a link, a picture or a table. See types.ts, "The
 * right-click menu", for the slots, and core/contextMenu.tsx for what hears the click.
 *
 * Every row that changes the document is gated on `ctx.can.edit`, so a reader's menu over a link is
 * Open (and Copy link, where copying is allowed) and over a picture or a table is nothing, which leaves
 * them the browser's. What the rows do is what the ribbon and the command box do: a Tiptap chain on
 * the editor, with the focus put back in the page first.
 */

import type { Editor } from '@tiptap/core';
import type { ContextEntry, ContextGroup } from '../../core/ContextMenu';
import { arrowSquareOutIcon, copyIcon, linkBreakIcon, notePencilIcon, pencilSimpleIcon, trashIcon } from '../../core/icons';
import { copyText } from '../../core/ui';
import { arrowsMergeIcon, arrowsSplitIcon, columnsPlusLeftIcon, columnsPlusRightIcon, rowsPlusBottomIcon, rowsPlusTopIcon } from '../core/icons';
import { removeLink } from '../core/links';
import { openLink } from '../core/ui';
import { openAltText } from '../core/contextMenu';
import type { DocsContext, DocsMenuTarget, DocsModule } from './types';

const run = (c: DocsContext, fn: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>): void => {
  if (c.editor) fn(c.editor.chain().focus()).run();
};

/** Whether a command could run now, for a row to be off when it could not. */
const can = (c: DocsContext, ask: (e: ReturnType<Editor['can']>) => boolean): boolean => (c.editor ? ask(c.editor.can()) : false);

function linkGroup(c: DocsContext, href: string): ContextGroup {
  const items: ContextEntry[] = [{ label: 'Open link', icon: arrowSquareOutIcon, onSelect: () => void window.open(href, '_blank', 'noopener,noreferrer') }];
  if (!c.caps.restricted) {
    items.push({
      label: 'Copy link',
      icon: copyIcon,
      onSelect: () => void copyText(href).then((ok) => c.notify(ok ? { text: 'Copied the link.' } : { text: 'Could not copy the link.', tone: 'danger' }))
    });
  }
  if (c.can.edit && c.editor) {
    const editor = c.editor;
    items.push({ label: 'Edit link', icon: pencilSimpleIcon, onSelect: () => openLink(editor) });
    items.push({ label: 'Remove link', icon: linkBreakIcon, onSelect: () => void removeLink(editor) });
  }
  return { id: 'menu.link', order: 100, items };
}

function pictureGroup(c: DocsContext, pos: number): ContextGroup {
  if (!c.can.edit) return { id: 'menu.picture', order: 200, items: [] };
  return {
    id: 'menu.picture',
    order: 200,
    items: [
      { label: 'Alt text…', icon: notePencilIcon, onSelect: () => openAltText(pos) },
      {
        label: 'Delete picture',
        icon: trashIcon,
        danger: true,
        onSelect: () =>
          run(c, (ch) =>
            ch.command(({ tr, state }) => {
              const node = state.doc.nodeAt(pos);
              if (node?.type.name !== 'image') return false;
              tr.delete(pos, pos + node.nodeSize);
              return true;
            })
          )
      }
    ]
  };
}

function tableGroup(c: DocsContext): ContextGroup {
  if (!c.can.edit) return { id: 'menu.table', order: 300, items: [] };
  return {
    id: 'menu.table',
    order: 300,
    items: [
      { label: 'Insert row above', icon: rowsPlusTopIcon, disabled: !can(c, (e) => e.addRowBefore()), onSelect: () => run(c, (ch) => ch.addRowBefore()) },
      { label: 'Insert row below', icon: rowsPlusBottomIcon, disabled: !can(c, (e) => e.addRowAfter()), onSelect: () => run(c, (ch) => ch.addRowAfter()) },
      { label: 'Insert column left', icon: columnsPlusLeftIcon, disabled: !can(c, (e) => e.addColumnBefore()), onSelect: () => run(c, (ch) => ch.addColumnBefore()) },
      { label: 'Insert column right', icon: columnsPlusRightIcon, disabled: !can(c, (e) => e.addColumnAfter()), onSelect: () => run(c, (ch) => ch.addColumnAfter()) },
      { label: 'Delete row', separated: true, disabled: !can(c, (e) => e.deleteRow()), onSelect: () => run(c, (ch) => ch.deleteRow()) },
      { label: 'Delete column', disabled: !can(c, (e) => e.deleteColumn()), onSelect: () => run(c, (ch) => ch.deleteColumn()) },
      { label: 'Merge cells', icon: arrowsMergeIcon, separated: true, disabled: !can(c, (e) => e.mergeCells()), onSelect: () => run(c, (ch) => ch.mergeCells()) },
      { label: 'Split cell', icon: arrowsSplitIcon, disabled: !can(c, (e) => e.splitCell()), onSelect: () => run(c, (ch) => ch.splitCell()) },
      { label: 'Delete table', icon: trashIcon, danger: true, separated: true, disabled: !can(c, (e) => e.deleteTable()), onSelect: () => run(c, (ch) => ch.deleteTable()) }
    ]
  };
}

export function contextItems(t: DocsMenuTarget, c: DocsContext): ContextGroup[] {
  const groups: ContextGroup[] = [];
  if (t.link) groups.push(linkGroup(c, t.link.href));
  if (t.image) groups.push(pictureGroup(c, t.image.pos));
  if (t.table) groups.push(tableGroup(c));
  return groups;
}

export const menusModule: DocsModule = {
  id: 'menus',
  extensions: [],
  ribbon: [],
  commands: [],
  contextItems
};
