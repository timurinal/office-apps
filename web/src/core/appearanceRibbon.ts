/**
 * The Appearance control every editor's View tab carries, and the Ctrl+K commands for it. The
 * choice is `core/appearance.ts`'s: it needs no context, so the group is generic in `C` and an
 * editor drops it into its own module with the slot it has free.
 */

import circleHalfRaw from '@phosphor-icons/core/assets/regular/circle-half.svg?raw';
import { APPEARANCES, appearanceState, setAppearance, type Appearance } from './appearance';
import { ph } from './icons';
import type { Command, MenuEntry, RibbonGroup } from './shell/types';

export const circleHalfIcon = /* @__PURE__ */ ph(circleHalfRaw);

const LABEL: Record<Appearance, string> = { system: 'System', light: 'Light', dark: 'Dark' };

function entries<C>(): MenuEntry<C>[] {
  return APPEARANCES.map((a) => ({
    label: LABEL[a],
    active: () => appearanceState().appearance === a,
    run: () => setAppearance(a)
  }));
}

/** A group with the Theme menu. `order` is its slot on the View tab. */
export function appearanceGroup<C>(order: number): RibbonGroup<C> {
  return {
    id: 'view.appearance',
    tab: 'view',
    order,
    label: 'Appearance',
    items: [{ type: 'menu', id: 'view.theme', label: 'Theme', icon: circleHalfIcon, showLabel: true, entries: entries<C>() }]
  };
}

export function appearanceCommands<C>(): Command<C>[] {
  return [
    { id: 'view.theme-system', title: 'Use the system theme', section: 'View', icon: circleHalfIcon, keywords: ['appearance', 'dark', 'light', 'match'], run: () => setAppearance('system') },
    { id: 'view.theme-light', title: 'Use the light theme', section: 'View', icon: circleHalfIcon, keywords: ['appearance', 'day'], run: () => setAppearance('light') },
    { id: 'view.theme-dark', title: 'Use the dark theme', section: 'View', icon: circleHalfIcon, keywords: ['appearance', 'night'], run: () => setAppearance('dark') }
  ];
}
