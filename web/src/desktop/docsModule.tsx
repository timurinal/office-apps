/**
 * Docs, on the desktop: the save state in the footer, New, Open, Save and Save as, and Export a copy.
 * Listed last in `docs/modules/index.ts`; everything in it is hidden outside a desktop window.
 */

import type { DocsContext, DocsModule } from '../docs/modules/types';
import { DOCS_EXPORTS, exportRows } from './exports';
import { commandRows, fileRows, SaveStatus } from './parts';
import { currentSession } from './session';

const exports = exportRows(DOCS_EXPORTS, (c) => c.editor !== null);

export const desktopDocsModule: DocsModule = {
  id: 'desktop',
  extensions: [],
  ribbon: [],
  commands: [...commandRows<DocsContext>(), ...exports.commands],
  fileItems: [...fileRows<DocsContext>(), exports.fileItem],
  statusItems: [{ id: 'desktop.save', side: 'left', order: 31, visible: () => currentSession() !== null, render: (c) => <SaveStatus ctx={c} ready={c.editor !== null} /> }]
};
