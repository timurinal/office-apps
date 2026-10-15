/**
 * The page view as one Tiptap extension: the plugin, the nodes it adds (page break,
 * footnote, table of contents), its commands, and a store per editor for React.
 *
 * The extension list is built once and shared by every editor, so nothing here is
 * configured per document. What is per document lives in the storage (`PageStore`),
 * which Tiptap makes once per editor.
 */

import { Extension, type Editor } from '@tiptap/core';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import type { HFKind } from './headerFooter';
import { Footnote, PageBreak, PageKeys, TableOfContents } from './nodes';
import { createPaginationPlugin, pageAt, partsAt } from './plugin';
import { PAGE_MAP, defaultSize, writeSetup, type SetupPatch } from './setup';
import { PageStore } from './store';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pagination: {
      /** Change the paper, orientation, margins or header distances, for everyone. */
      setPageSetup: (patch: SetupPatch) => ReturnType;
      /** Print layout (true) or web layout (false). */
      setPaged: (paged: boolean) => ReturnType;
      /** Edit the header or footer of the caret's page, in place. */
      editHeaderFooter: (kind: HFKind) => ReturnType;
      /** Read the whole body again. */
      relayout: () => ReturnType;
    };
  }
}

interface PaginationStorage {
  store: PageStore;
  /** The paper's default is written once per editor at most. */
  defaulted: boolean;
}

export const pageStoreOf = (editor: Editor | null): PageStore | null =>
  editor ? ((editor.storage as unknown as Record<string, PaginationStorage | undefined>).pagination?.store ?? null) : null;

export const Pagination = Extension.create<unknown, PaginationStorage>({
  name: 'pagination',

  addStorage: () => ({ store: new PageStore(), defaulted: false }),

  addExtensions: () => [
    PageBreak,
    Footnote,
    TableOfContents.configure({ pageOf: (view, pos) => pageAt(view.state, pos), partsOf: (view, pos) => partsAt(view.state, pos) }),
    PageKeys
  ],

  addProseMirrorPlugins() {
    return [createPaginationPlugin(this.storage.store)];
  },

  addCommands() {
    return {
      setPageSetup:
        (patch) =>
        ({ dispatch }) => {
          const c = this.storage.store.control;
          if (!c?.canWrite()) return false;
          if (dispatch) c.setSetup(patch);
          return true;
        },
      setPaged:
        (paged) =>
        ({ dispatch }) => {
          const c = this.storage.store.control;
          if (!c) return false;
          if (dispatch) c.setPaged(paged);
          return true;
        },
      editHeaderFooter:
        (kind) =>
        ({ dispatch }) => {
          const c = this.storage.store.control;
          if (!c?.canWrite()) return false;
          return dispatch ? c.editHeaderFooter(kind) : true;
        },
      relayout:
        () =>
        ({ dispatch }) => {
          const c = this.storage.store.control;
          if (!c) return false;
          if (dispatch) c.relayout();
          return true;
        }
    };
  },

  /**
   * The paper's default (A4, or Letter in en-US) is written by the first edit this person
   * makes after the room's state has arrived, and only if nobody has written one. Before
   * then the document would take whichever reader opened it first; written at open, a
   * reader would be writing.
   */
  onUpdate({ transaction }) {
    if (this.storage.defaulted || !this.storage.store.synced || !this.editor.isEditable) return;
    const sync = ySyncPluginKey.getState(this.editor.state);
    if (!sync?.doc) return;
    // A change that arrived from someone else is not this person's edit.
    const remote = (transaction.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;
    if (remote) return;
    this.storage.defaulted = true;
    const doc = sync.doc;
    if (doc.getMap<unknown>(PAGE_MAP).has('size')) return;
    // After this transaction's own Yjs update, not inside it.
    queueMicrotask(() => {
      if (!doc.getMap<unknown>(PAGE_MAP).has('size')) writeSetup(doc, { size: defaultSize() });
    });
  }
});
