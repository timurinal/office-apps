/**
 * Sheets, on the desktop: the save state in the footer, New, Open, Save and Save as, and Export a copy.
 * Listed last in `sheets/modules/index.ts`; everything in it is hidden outside a desktop window.
 */

import type { SheetsContext, SheetsModule } from '../sheets/modules/types';
import { exportRows, SHEETS_EXPORTS } from './exports';
import { commandRows, fileRows, SaveStatus } from './parts';
import { currentSession } from './session';

const exports = exportRows(SHEETS_EXPORTS, (c) => c.model.status().loaded);

export const desktopSheetsModule: SheetsModule = {
  id: 'desktop',
  ribbon: [],
  commands: [...commandRows<SheetsContext>(), ...exports.commands],
  fileItems: [...fileRows<SheetsContext>(), exports.fileItem],
  statusItems: [{ id: 'desktop.save', side: 'left', order: 31, visible: () => currentSession() !== null, render: (c) => <SaveStatus ctx={c} ready={c.model.status().loaded} /> }]
};
