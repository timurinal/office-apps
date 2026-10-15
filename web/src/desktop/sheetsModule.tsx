/**
 * Sheets, on the desktop: the save state in the footer, and New, Open, Save and Save as.
 * Listed last in `sheets/modules/index.ts`; everything in it is hidden outside a desktop window.
 */

import type { SheetsContext, SheetsModule } from '../sheets/modules/types';
import { commandRows, fileRows, SaveStatus } from './parts';
import { currentSession } from './session';

export const desktopSheetsModule: SheetsModule = {
  id: 'desktop',
  ribbon: [],
  commands: commandRows<SheetsContext>(),
  fileItems: fileRows<SheetsContext>(),
  statusItems: [{ id: 'desktop.save', side: 'left', order: 31, visible: () => currentSession() !== null, render: (c) => <SaveStatus ctx={c} ready={c.model.status().loaded} /> }]
};
