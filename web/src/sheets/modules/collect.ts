/**
 * The modules, flattened into what the editor draws.
 *
 * Kept apart from `index.ts` so a test can collect its own list, and so the rule that two
 * modules may not share an id is checked in one place.
 */

import type { Command, EditingMode, FileItem, PaneSpec, RibbonGroup, StatusItem } from '../../core/shell/types';
import { duplicateIds } from '../../core/shell/registry';
import type { SheetsContext, SheetsKey, SheetsModule, SheetsOverlay } from './types';

export interface Collected {
  ribbon: RibbonGroup<SheetsContext>[];
  commands: Command<SheetsContext>[];
  keys: SheetsKey[];
  panes: PaneSpec<SheetsContext>[];
  statusItems: StatusItem<SheetsContext>[];
  fileItems: FileItem<SheetsContext>[];
  modes: EditingMode[];
  overlays: SheetsOverlay[];
  intents: NonNullable<SheetsModule['onIntent']>[];
}

export function collect(modules: readonly SheetsModule[]): Collected {
  const out: Collected = { ribbon: [], commands: [], keys: [], panes: [], statusItems: [], fileItems: [], modes: [], overlays: [], intents: [] };
  for (const m of modules) {
    out.ribbon.push(...m.ribbon);
    out.commands.push(...m.commands);
    out.keys.push(...(m.keys ?? []));
    out.panes.push(...(m.panes ?? []));
    out.statusItems.push(...(m.statusItems ?? []));
    out.fileItems.push(...(m.fileItems ?? []));
    out.modes.push(...(m.modes ?? []));
    out.overlays.push(...(m.overlays ?? []));
    if (m.onIntent) out.intents.push(m.onIntent);
  }
  return out;
}

/** Everything that has to be unique and is not: a problem to fix, not to survive. */
export function problems(modules: readonly SheetsModule[]): string[] {
  const out: string[] = [];
  const seen = (label: string, ids: string[]) => {
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    for (const id of new Set(dup)) out.push(`${label} "${id}" is used twice`);
  };
  seen('module', modules.map((m) => m.id));
  const all = collect(modules);
  for (const id of duplicateIds(all.ribbon)) out.push(`ribbon id "${id}" is used twice`);
  seen('command', all.commands.map((c) => c.id));
  seen('key', all.keys.map((k) => k.keys));
  seen('pane', all.panes.map((p) => p.id));
  seen('status item', all.statusItems.map((s) => s.id));
  seen('file item', all.fileItems.map((f) => f.id));
  seen('mode', all.modes.map((m) => m.id));
  seen('overlay', all.overlays.map((o) => o.id));
  return out;
}
