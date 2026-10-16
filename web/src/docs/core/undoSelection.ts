/**
 * Undo and redo put back the selection the step was made from.
 *
 * y-tiptap's undo plugin keeps that selection on each step (`stack-item-added`)
 * and means to restore it on `stack-item-popped`. Yjs announces a popped step
 * only after the undo has been applied and drawn, so the selection lands nowhere
 * and the caret stays where it was relative to the text: undoing a Replace left
 * a caret beside the word instead of the word selected, as Word has it.
 *
 * Only a text selection is put back. A node or a cell selection that a remote
 * edit has taken apart has no sensible place to land.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { relativePositionToAbsolutePosition, ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap';

interface Saved {
  type?: string;
  anchor: unknown;
  head: unknown;
}

const key = new PluginKey('undoSelection');

export const UndoSelection = Extension.create({
  name: 'undoSelection',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        view: (view) => {
          const manager = yUndoPluginKey.getState(view.state)?.undoManager;
          if (!manager) return {};
          const popped = ({ stackItem }: { stackItem: { meta: Map<unknown, unknown> } }): void => {
            const binding = ySyncPluginKey.getState(view.state)?.binding;
            const saved = binding ? (stackItem.meta.get(binding) as Saved | undefined) : undefined;
            if (!binding || !saved || saved.type !== 'text' || !saved.anchor || !saved.head) return;
            const at = (rel: unknown) =>
              relativePositionToAbsolutePosition(binding.doc, binding.type, rel as never, binding.mapping);
            const anchor = at(saved.anchor);
            const head = at(saved.head);
            const { doc } = view.state;
            if (anchor === null || head === null || Math.max(anchor, head) > doc.content.size) return;
            const selection = TextSelection.between(doc.resolve(anchor), doc.resolve(head));
            if (selection.eq(view.state.selection)) return;
            view.dispatch(view.state.tr.setSelection(selection).setMeta('addToHistory', false).scrollIntoView());
          };
          manager.on('stack-item-popped', popped);
          return { destroy: () => manager.off('stack-item-popped', popped) };
        }
      })
    ];
  }
});
