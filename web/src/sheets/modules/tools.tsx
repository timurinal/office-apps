/**
 * The overlays the formatting and data tools share: the host that mounts whichever dialog, menu or bar
 * is open (`panes/ToolsHost.tsx`), and the one that lays the format painter's format down. They have
 * no ribbon, commands or keys of their own, so they are a module of their own, listed once.
 */

import { ToolsHost } from '../panes/ToolsHost';
import { PainterHost } from './painterHost';
import type { SheetsModule } from './types';

export const toolsModule: SheetsModule = {
  id: 'tools',
  ribbon: [],
  commands: [],
  overlays: [
    { id: 'tools.host', render: (c) => <ToolsHost ctx={c} /> },
    { id: 'tools.painter', render: (c) => <PainterHost ctx={c} /> }
  ]
};
