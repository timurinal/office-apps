/**
 * The modules, flattened into what the editor draws.
 *
 * Kept apart from `index.ts` so a test can collect its own list, and so the rule
 * that two modules may not share an id is checked in one place.
 */

import type { AnyExtension } from '@tiptap/core';
import type { ContextHook } from '../../core/ContextMenu';
import type { Command, EditingMode, FileItem, PaneSpec, RibbonGroup, StatusItem } from '../../core/shell/types';
import { duplicateIds } from '../../core/shell/registry';
import type { DocsContext, DocsMenuTarget, DocsModule } from './types';

export interface Collected {
  extensions: AnyExtension[];
  ribbon: RibbonGroup<DocsContext>[];
  commands: Command<DocsContext>[];
  panes: PaneSpec<DocsContext>[];
  statusItems: StatusItem<DocsContext>[];
  fileItems: FileItem<DocsContext>[];
  modes: EditingMode[];
  context: ContextHook<DocsMenuTarget, DocsContext>[];
}

export function collect(modules: readonly DocsModule[]): Collected {
  const out: Collected = { extensions: [], ribbon: [], commands: [], panes: [], statusItems: [], fileItems: [], modes: [], context: [] };
  for (const m of modules) {
    out.extensions.push(...m.extensions);
    out.ribbon.push(...m.ribbon);
    out.commands.push(...m.commands);
    out.panes.push(...(m.panes ?? []));
    out.statusItems.push(...(m.statusItems ?? []));
    out.fileItems.push(...(m.fileItems ?? []));
    out.modes.push(...(m.modes ?? []));
    if (m.contextItems) out.context.push(m.contextItems);
  }
  return out;
}

/** Everything that has to be unique and is not: a problem to fix, not to survive. */
export function problems(modules: readonly DocsModule[]): string[] {
  const out: string[] = [];
  const seen = (label: string, ids: string[]) => {
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    for (const id of new Set(dup)) out.push(`${label} "${id}" is used twice`);
  };
  seen('module', modules.map((m) => m.id));
  const all = collect(modules);
  for (const id of duplicateIds(all.ribbon)) out.push(`ribbon id "${id}" is used twice`);
  seen('command', all.commands.map((c) => c.id));
  seen('pane', all.panes.map((p) => p.id));
  seen('status item', all.statusItems.map((s) => s.id));
  seen('file item', all.fileItems.map((f) => f.id));
  seen('mode', all.modes.map((m) => m.id));
  return out;
}
