/**
 * A read-only page never changes the document.
 *
 * Some plugins add to a document on their own: StarterKit's trailing node appends an empty
 * paragraph when the last block is a list or a table. In an editor that cannot be typed in
 * (a viewer, a commenter, a version's preview) that is still a change, the Yjs binding writes
 * it, and the room refuses a viewer's update and closes the socket: "This document could not
 * be kept in sync", on opening a document that ends in a list.
 *
 * So a transaction that changes the document is let through only if the editor is editable or
 * the change is the binding's own, a Yjs update arriving from somewhere else.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ySyncPluginKey } from '@tiptap/y-tiptap';

export const readOnlyGuard = Extension.create({
  name: 'oaReadOnlyGuard',

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('oaReadOnlyGuard'),
        filterTransaction: (tr) => {
          if (!tr.docChanged || editor.isEditable) return true;
          const sync = tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined;
          return sync?.isChangeOrigin === true;
        }
      })
    ];
  }
});
