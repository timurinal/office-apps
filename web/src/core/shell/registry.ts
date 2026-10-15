/**
 * Turning the modules' contributions into what the shell draws.
 *
 * Pure functions, so the rules (which tabs show, what order groups sit in, what a
 * search ranks first) are tested without a DOM and the shell is only drawing.
 */

import type {
  Command,
  EditingMode,
  FileItem,
  RibbonGroup,
  RibbonItem,
  StatusItem,
  TabDef
} from './types';

// ── ribbon ──────────────────────────────────────────────────────────────────

const shown = <C>(item: { visible?: (c: C) => boolean }, ctx: C): boolean => item.visible?.(ctx) ?? true;

/**
 * An item list with what is hidden removed, and the separators tidied: none first
 * or last, never two together, so hiding the only item between two rules does not
 * leave a double line.
 */
export function visibleItems<C>(items: readonly RibbonItem<C>[], ctx: C): RibbonItem<C>[] {
  const out: RibbonItem<C>[] = [];
  for (const item of items) {
    if (item.type === 'separator') {
      const last = out[out.length - 1];
      if (!last || last.type === 'separator') continue;
    } else if (!shown(item, ctx)) continue;
    out.push(item);
  }
  while (out[out.length - 1]?.type === 'separator') out.pop();
  return out;
}

/** The groups on one tab, left to right, with empty ones dropped. */
export function groupsFor<C>(groups: readonly RibbonGroup<C>[], tab: string, ctx: C): RibbonGroup<C>[] {
  return groups
    .filter((g) => g.tab === tab)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((g) => ({ ...g, items: visibleItems(g.items, ctx) }))
    .filter((g) => g.items.some((i) => i.type !== 'separator'));
}

/**
 * The tabs to draw. A tab with nothing to show is not drawn (a dead tab is worse
 * than none), except `file`, whose menu is not a group. A module that contributes
 * the first group to "Layout" makes the tab appear.
 */
export function visibleTabs<C>(tabs: readonly TabDef[], groups: readonly RibbonGroup<C>[], ctx: C): TabDef[] {
  return tabs.filter((t) => t.id === 'file' || groupsFor(groups, t.id, ctx).length > 0);
}

/** An id used twice among the groups, or twice among the items (an item may share
 *  its group's id), which would make two controls share one state. */
export function duplicateIds<C>(groups: readonly RibbonGroup<C>[]): string[] {
  const dup = new Set<string>();
  const groupIds = new Set<string>();
  const itemIds = new Set<string>();
  const see = (set: Set<string>, id: string) => (set.has(id) ? dup.add(id) : set.add(id));
  for (const g of groups) {
    see(groupIds, g.id);
    for (const item of g.items) if (item.type !== 'separator') see(itemIds, item.id);
  }
  return [...dup];
}

export interface ItemState {
  active: boolean;
  disabled: boolean;
  /** For a select, a gallery or a colour: the current value. */
  value: string | null;
}

/** What each item reads from the context right now, by id. */
export function itemStates<C>(items: readonly RibbonItem<C>[], ctx: C): Map<string, ItemState> {
  const out = new Map<string, ItemState>();
  for (const item of items) {
    if (item.type === 'separator' || item.type === 'custom') continue;
    out.set(item.id, {
      active: 'active' in item && item.active ? item.active(ctx) : false,
      disabled: item.disabled?.(ctx) ?? false,
      value: 'value' in item && item.value ? item.value(ctx) : null
    });
  }
  return out;
}

export function statesEqual(a: ReadonlyMap<string, ItemState>, b: ReadonlyMap<string, ItemState>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, s] of a) {
    const t = b.get(id);
    if (!t || t.active !== s.active || t.disabled !== s.disabled || t.value !== s.value) return false;
  }
  return true;
}

// ── panes, status, file, modes ──────────────────────────────────────────────

export function statusFor<C>(items: readonly StatusItem<C>[], side: 'left' | 'right', ctx: C): StatusItem<C>[] {
  return items
    .filter((i) => i.side === side && shown(i, ctx))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export interface FileSection<C> {
  section: string;
  items: FileItem<C>[];
}

/** The File menu's rows, in sections. A section sits where its first row says. */
export function fileSections<C>(items: readonly FileItem<C>[], ctx: C): FileSection<C>[] {
  const sorted = items.filter((i) => shown(i, ctx)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const out: FileSection<C>[] = [];
  for (const item of sorted) {
    let s = out.find((x) => x.section === item.section);
    if (!s) out.push((s = { section: item.section, items: [] }));
    s.items.push(item);
  }
  return out;
}

export const sortedModes = (modes: readonly EditingMode[]): EditingMode[] =>
  [...modes].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

// ── commands ────────────────────────────────────────────────────────────────

/**
 * How well a command matches what was typed, 0 for not at all. A title that starts
 * with it beats one with a word that does, which beats one that merely contains it,
 * which beats a keyword, which beats the letters appearing in order ("tbl" finds
 * "Insert table"). The ranking is the whole feature of a search box people type
 * three letters into.
 */
export function scoreText(title: string, keywords: readonly string[], query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = title.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.split(/[\s\-/]+/).some((w) => w.startsWith(q))) return 60;
  if (t.includes(q)) return 40;
  if (keywords.some((k) => k.toLowerCase().startsWith(q))) return 30;
  if (keywords.some((k) => k.toLowerCase().includes(q))) return 20;
  // Letters in order only from three typed: with two, nearly everything matches.
  if (q.length < 3) return 0;
  let at = 0;
  for (const ch of t) if (ch === q[at]) at += 1;
  return at === q.length ? 10 : 0;
}

export function searchCommands<C>(commands: readonly Command<C>[], query: string, ctx: C, limit = 12): Command<C>[] {
  return commands
    .filter((c) => shown(c, ctx))
    .map((c, i) => ({ c, i, s: scoreText(c.title, c.keywords ?? [], query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}
