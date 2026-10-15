/**
 * Lists: bulleted, numbered, multilevel and checklists.
 *
 * Bulleted and numbered lists are the base list's (StarterKit); this adds the checklist
 * (Tiptap's task list, nestable) and the numbering format of an ordered list.
 *
 * ── Multilevel ──────────────────────────────────────────────────────────────
 * A numbered list nests (Tab, Shift+Tab) and each level restarts in the next style: 1.
 * a. i. 1. a. i., drawn by CSS from how deep the list is, so nothing is stored per level
 * and a nested list made later matches without being told. A list can instead be
 * `legal`: 1. then 1.1. then 1.1.1., the way contracts number. That one is stored, on the
 * outermost ordered list, and the CSS reads it from there (core.css), because Tab makes a
 * nested list with default attributes and the format would otherwise fall off at level two.
 */

import { Extension, type Editor } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import type { Node as PMNode } from '@tiptap/pm/model';

export type ListFormat = 'mixed' | 'legal';

export const LIST_FORMATS: ReadonlyArray<{ value: ListFormat; label: string }> = [
  { value: 'mixed', label: '1. a. i.' },
  { value: 'legal', label: '1. 1.1. 1.1.1.' }
];

/** Where a numbered list's format is stored: an attribute of every ordered list. */
export const listFormatAttribute = Extension.create({
  name: 'listFormat',

  addGlobalAttributes() {
    return [
      {
        types: ['orderedList'],
        attributes: {
          format: {
            default: null,
            parseHTML: (el: HTMLElement) => (el.getAttribute('data-format') === 'legal' ? 'legal' : null),
            renderHTML: (attrs: Record<string, unknown>) => (attrs.format === 'legal' ? { 'data-format': 'legal' } : {})
          }
        }
      }
    ];
  },

  addKeyboardShortcuts() {
    // Docs' shortcut for a checklist, beside Word's 7 and 8 for numbers and bullets.
    return { 'Mod-Shift-9': () => this.editor.commands.toggleTaskList() };
  }
});

export const taskList = TaskList;
export const taskItem = TaskItem.configure({ nested: true });

export const listKit = [taskList, taskItem, listFormatAttribute];

// ── the numbering format ────────────────────────────────────────────────────

/** The outermost numbered list the selection is in, with where it starts. */
function outerOrdered(editor: Editor): { node: PMNode; pos: number } | null {
  const { $from } = editor.state.selection;
  let found: { node: PMNode; pos: number } | null = null;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'orderedList') found = { node, pos: $from.before(d) };
  }
  return found;
}

export function listFormatAt(editor: Editor): ListFormat | null {
  const list = outerOrdered(editor);
  return list ? (list.node.attrs.format === 'legal' ? 'legal' : 'mixed') : null;
}

/** Number the list the selection is in, making it numbered first if it is not. */
export function setListFormat(editor: Editor, format: ListFormat): boolean {
  if (!outerOrdered(editor)) editor.chain().focus().toggleOrderedList().run();
  const list = outerOrdered(editor);
  if (!list) return false;
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setNodeMarkup(list.pos, undefined, { ...list.node.attrs, format: format === 'legal' ? 'legal' : null });
      return true;
    })
    .run();
}
