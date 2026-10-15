/**
 * What the extensions need to know about the screen they are in.
 *
 * The extension list is built once, at module load, and shared by every editor, so an
 * extension cannot be configured with this document's id, whether it has a server, or
 * where a toast goes. The editor's own storage is per editor, and the core module's
 * footer item (`CoreHost`, overlays.tsx) writes the current `DocsContext` into it on
 * every render. A paste, a drop or a keystroke reads it when it happens and never holds
 * on to it.
 */

import { Extension, type Editor } from '@tiptap/core';
import type { DocsContext } from '../modules/types';
import { storageOf } from './storage';
import { createUiStore, type UiStore } from './ui';

interface EnvStorage {
  ctx: DocsContext | null;
  ui: UiStore;
}

export const coreEnv = Extension.create<unknown, EnvStorage>({
  name: 'oaCore',
  addStorage() {
    return { ctx: null, ui: createUiStore() };
  }
});

export const ctxOf = (editor: Editor): DocsContext | null => storageOf<EnvStorage | undefined>(editor, 'oaCore')?.ctx ?? null;

export function provideCtx(editor: Editor, ctx: DocsContext): void {
  const s = storageOf<EnvStorage | undefined>(editor, 'oaCore');
  if (s) s.ctx = ctx;
}
