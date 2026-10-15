import type { Editor } from '@tiptap/core';

/** An extension's per-editor storage. `editor.storage` is typed as the DOM's `Storage`. */
export const storageOf = <T>(editor: Editor, name: string): T => (editor.storage as unknown as Record<string, T>)[name] as T;
