/**
 * The editor's extensions: the base list, and what the modules add.
 *
 * This file is where the base list lives. It is what every Docs document is, on
 * any source: StarterKit (paragraphs, headings, lists, quote, code, marks, link,
 * history is off), the collaboration binding to the document, and, only where
 * other people can be, their carets.
 *
 * A module adds extensions by exporting them in its `extensions` array
 * (docs/modules/types.ts); `documentExtensions` appends those, in module order, so
 * a module that must come first can use Tiptap's `priority`. Nothing here needs to
 * change to add one.
 */

import type { AnyExtension } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import StarterKit from '@tiptap/starter-kit';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { RemoteCarets } from '../core/carets';
import { isSafeHref } from './core/links';
import { UndoSelection } from './core/undoSelection';
import { DOCS_MODULES } from './modules';
import type { DocsModule } from './modules/types';
import { readOnlyGuard } from './readOnly';
import { FIELD } from './room';

export interface PageUser {
  name: string;
  color: string;
}

export interface ExtensionEnv {
  doc: Y.Doc;
  /** Present where other people can be (a room). Without it there are no carets. */
  awareness: Awareness | null;
  user?: PageUser;
}

/**
 * The undo history is the Collaboration extension's (a Yjs undo manager that
 * undoes only this person's changes), so StarterKit's own is off: with both on,
 * Ctrl+Z would rewind other people's typing.
 */
export function baseExtensions(env: ExtensionEnv): AnyExtension[] {
  return [
    StarterKit.configure({
      undoRedo: false,
      link: {
        // A click puts the caret in the text. Following a link is the reader's
        // choice, from the address in the ribbon or a new tab.
        openOnClick: false,
        autolink: true,
        // http, https and mailto, for what is pasted, autolinked, or comes from another
        // person's edit as much as for what the link popover accepts (docs/core/links.ts).
        isAllowedUri: (url) => isSafeHref(url),
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' }
      }
    }),
    Collaboration.configure({ document: env.doc, field: FIELD }),
    UndoSelection,
    readOnlyGuard,
    ...(env.awareness && env.user
      ? [RemoteCarets.configure({ awareness: env.awareness, user: env.user })]
      : [])
  ];
}

export function documentExtensions(env: ExtensionEnv, modules: readonly DocsModule[] = DOCS_MODULES): AnyExtension[] {
  return [...baseExtensions(env), ...modules.flatMap((m) => m.extensions)];
}
