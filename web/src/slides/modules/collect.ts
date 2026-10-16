/**
 * The modules, flattened into what the editor draws.
 *
 * Kept apart from `index.ts` so a test can collect its own list, and so the rule that two modules
 * may not share an id is checked in one place.
 */

import type { ContextHook } from '../../core/ContextMenu';
import { duplicateIds } from '../../core/shell/registry';
import type { Command, EditingMode, FileItem, PaneSpec, RibbonGroup, StatusItem } from '../../core/shell/types';
import type { CanvasLayer, Presenter, SlidesContext, SlidesKey, SlidesMenuTarget, SlidesModule, SlidesOverlay, SlidesView } from './types';

export interface Collected {
  ribbon: RibbonGroup<SlidesContext>[];
  commands: Command<SlidesContext>[];
  keys: SlidesKey[];
  panes: PaneSpec<SlidesContext>[];
  statusItems: StatusItem<SlidesContext>[];
  fileItems: FileItem<SlidesContext>[];
  modes: EditingMode[];
  overlays: SlidesOverlay[];
  canvas: CanvasLayer[];
  snaps: NonNullable<SlidesModule['snap']>[];
  /** Sorted by `order`. */
  views: SlidesView[];
  /** The first module's. */
  presenter: Presenter | null;
  context: ContextHook<SlidesMenuTarget, SlidesContext>[];
}

export function collect(modules: readonly SlidesModule[]): Collected {
  const out: Collected = {
    ribbon: [],
    commands: [],
    keys: [],
    panes: [],
    statusItems: [],
    fileItems: [],
    modes: [],
    overlays: [],
    canvas: [],
    snaps: [],
    views: [],
    presenter: null,
    context: []
  };
  for (const m of modules) {
    out.ribbon.push(...m.ribbon);
    out.commands.push(...m.commands);
    out.keys.push(...(m.keys ?? []));
    out.panes.push(...(m.panes ?? []));
    out.statusItems.push(...(m.statusItems ?? []));
    out.fileItems.push(...(m.fileItems ?? []));
    out.modes.push(...(m.modes ?? []));
    out.overlays.push(...(m.overlays ?? []));
    out.canvas.push(...(m.canvas ?? []));
    out.views.push(...(m.views ?? []));
    if (m.snap) out.snaps.push(m.snap);
    if (m.contextItems) out.context.push(m.contextItems);
    if (m.presenter && !out.presenter) out.presenter = m.presenter;
  }
  out.views.sort((a, b) => a.order - b.order);
  return out;
}

/** Everything that has to be unique and is not: a problem to fix, not to survive. */
export function problems(modules: readonly SlidesModule[]): string[] {
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
  seen('pane', ['history', ...all.panes.map((p) => p.id)]);
  seen('status item', all.statusItems.map((s) => s.id));
  seen('file item', all.fileItems.map((f) => f.id));
  seen('mode', all.modes.map((m) => m.id));
  seen('overlay', all.overlays.map((o) => o.id));
  seen('canvas layer', all.canvas.map((o) => o.id));
  seen('view', ['normal', ...all.views.map((v) => v.id)]);
  if (modules.filter((m) => m.presenter).length > 1) out.push('more than one module has a presenter');
  return out;
}
