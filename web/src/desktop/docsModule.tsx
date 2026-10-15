/**
 * Docs, on the desktop: the save state in the footer, and New, Open, Save and Save as.
 * Listed last in `docs/modules/index.ts`; everything in it is hidden outside a desktop window.
 */

import type { DocsContext, DocsModule } from '../docs/modules/types';
import { commandRows, fileRows, SaveStatus } from './parts';
import { currentSession } from './session';

export const desktopDocsModule: DocsModule = {
  id: 'desktop',
  extensions: [],
  ribbon: [],
  commands: commandRows<DocsContext>(),
  fileItems: fileRows<DocsContext>(),
  statusItems: [{ id: 'desktop.save', side: 'left', order: 31, visible: () => currentSession() !== null, render: (c) => <SaveStatus ctx={c} ready={c.editor !== null} /> }]
};
