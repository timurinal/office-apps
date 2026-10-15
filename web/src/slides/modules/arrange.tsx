/**
 * The Arrange module: where an object sits among the others, and how the chosen ones sit together.
 *
 *   Home            Arrange ▾ (order, group, align, distribute, rotate and flip), in a group of its
 *                   own after the drawing tools
 *   canvas          the same rows in the right-click menu over an object (panes/format/ContextMenu.tsx)
 *   keys            Ctrl+G and Ctrl+Shift+G, Ctrl+] and Ctrl+[, and with Shift for the front and the back
 *   command box     each row, under Format
 *
 * What each row does is in `arrangeActions.ts`, one function each with a test; this file says where it
 * goes and when it is off. Ctrl+Shift+] and Ctrl+Shift+[ are written `Mod+Shift+}` and `Mod+Shift+{`,
 * because that is the `key` a keyboard with those symbols on the bracket keys sends with Shift held.
 *
 * Every row is off for a reader, and off when it would change nothing (Bring to front on what is
 * already in front). The keys are the canvas's: they do nothing while the slide list or a text box has
 * the keyboard.
 */

import { mod } from '../../core/keys';
import type { PhIcon } from '../../core/icons';
import type { Command, MenuEntry, RibbonGroup } from '../../core/shell/types';
import type { Target } from '../editor/actions';
import {
  align,
  canReorder,
  chosenCount,
  distribute,
  flip,
  group,
  hasGroup,
  MIN_TO_DISTRIBUTE,
  MIN_TO_GROUP,
  reorder,
  turn,
  ungroup,
  type AlignHow,
  type ZMove
} from './arrangeActions';
import {
  alignBottomIcon,
  alignCenterHorizontalIcon,
  alignCenterVerticalIcon,
  alignLeftIcon,
  alignRightIcon,
  alignTopIcon,
  arrowClockwiseIcon,
  arrowDownIcon,
  arrowLineDownIcon,
  arrowLineUpIcon,
  arrowUpIcon,
  arrowsLeftRightIcon,
  flipHorizontalIcon,
  flipVerticalIcon,
  stackIcon,
  subtractSquareIcon,
  uniteSquareIcon
} from './arrangeIcons';
import { arrowCounterClockwiseIcon } from '../../core/icons';
import { arrowsDownUpIcon } from './icons';
import type { SlidesContext, SlidesKey, SlidesModule } from './types';

const target = (c: SlidesContext): Target => ({ model: c.model, selection: c.selection });

/** The keyboard back where it was after a button or a menu. */
const back = (c: SlidesContext): void => (c.selection.get().focus === 'rail' ? c.actions.focusRail() : c.actions.focusCanvas());

type Section = 'order' | 'group' | 'align' | 'distribute' | 'turn';

interface Row {
  id: string;
  label: string;
  icon: PhIcon;
  /** As the menu and the tooltip show it. */
  shortcut?: string;
  /** What the browser's `KeyboardEvent.key` is, for `SlidesKey`. */
  keys?: string;
  section: Section;
  keywords?: string[];
  run: (t: Target) => unknown;
  /** Not available now: a reader, nothing chosen, nothing it would change. */
  off: (c: SlidesContext) => boolean;
  /** Not offered at all in the context menu now, as Ungroup is not when nothing chosen is a group. */
  hide?: (c: SlidesContext) => boolean;
}

const readOnly = (c: SlidesContext): boolean => !c.can.edit;

const orderRow = (how: ZMove, label: string, icon: PhIcon, shortcut: string, keys: string): Row => ({
  id: `arrange.${how}`,
  label,
  icon,
  shortcut,
  keys,
  section: 'order',
  keywords: ['order', 'z-order', 'layer', 'front', 'back'],
  run: (t) => reorder(t, how),
  off: (c) => readOnly(c) || !canReorder(target(c), how)
});

const ALIGNS: { how: AlignHow; label: string; icon: PhIcon }[] = [
  { how: 'left', label: 'Align left', icon: alignLeftIcon },
  { how: 'centre', label: 'Align centre', icon: alignCenterHorizontalIcon },
  { how: 'right', label: 'Align right', icon: alignRightIcon },
  { how: 'top', label: 'Align top', icon: alignTopIcon },
  { how: 'middle', label: 'Align middle', icon: alignCenterVerticalIcon },
  { how: 'bottom', label: 'Align bottom', icon: alignBottomIcon }
];

const noneToMove = (c: SlidesContext): boolean => readOnly(c) || chosenCount(target(c)).movable === 0;

/** Every row, in the order the menus list them. */
export const ARRANGE_ROWS: readonly Row[] = [
  orderRow('front', 'Bring to front', arrowLineUpIcon, mod('Shift+]'), 'Mod+Shift+}'),
  orderRow('forward', 'Bring forward', arrowUpIcon, mod(']'), 'Mod+]'),
  orderRow('backward', 'Send backward', arrowDownIcon, mod('['), 'Mod+['),
  orderRow('back', 'Send to back', arrowLineDownIcon, mod('Shift+['), 'Mod+Shift+{'),

  {
    id: 'arrange.group',
    label: 'Group',
    icon: uniteSquareIcon,
    shortcut: mod('G'),
    keys: 'Mod+G',
    section: 'group',
    keywords: ['combine', 'join'],
    run: (t) => group(t),
    off: (c) => readOnly(c) || chosenCount(target(c)).count < MIN_TO_GROUP,
    hide: (c) => chosenCount(target(c)).count < MIN_TO_GROUP
  },
  {
    id: 'arrange.ungroup',
    label: 'Ungroup',
    icon: subtractSquareIcon,
    shortcut: mod('Shift+G'),
    keys: 'Mod+Shift+G',
    section: 'group',
    keywords: ['split', 'separate'],
    run: (t) => ungroup(t),
    off: (c) => readOnly(c) || !hasGroup(target(c)),
    hide: (c) => !hasGroup(target(c))
  },

  ...ALIGNS.map(
    (a): Row => ({
      id: `arrange.align-${a.how}`,
      label: a.label,
      icon: a.icon,
      section: 'align',
      keywords: ['align', 'line up', 'position'],
      run: (t) => align(t, a.how),
      off: noneToMove
    })
  ),

  {
    id: 'arrange.distribute-horizontally',
    label: 'Distribute horizontally',
    icon: arrowsLeftRightIcon,
    section: 'distribute',
    keywords: ['space', 'even', 'equal'],
    run: (t) => distribute(t, 'horizontal'),
    off: (c) => readOnly(c) || chosenCount(target(c)).count < MIN_TO_DISTRIBUTE,
    hide: (c) => chosenCount(target(c)).count < MIN_TO_DISTRIBUTE
  },
  {
    id: 'arrange.distribute-vertically',
    label: 'Distribute vertically',
    icon: arrowsDownUpIcon,
    section: 'distribute',
    keywords: ['space', 'even', 'equal'],
    run: (t) => distribute(t, 'vertical'),
    off: (c) => readOnly(c) || chosenCount(target(c)).count < MIN_TO_DISTRIBUTE,
    hide: (c) => chosenCount(target(c)).count < MIN_TO_DISTRIBUTE
  },

  { id: 'arrange.rotate-right', label: 'Rotate right 90°', icon: arrowClockwiseIcon, section: 'turn', keywords: ['turn', 'clockwise'], run: (t) => turn(t, 'right'), off: noneToMove },
  { id: 'arrange.rotate-left', label: 'Rotate left 90°', icon: arrowCounterClockwiseIcon, section: 'turn', keywords: ['turn', 'anticlockwise'], run: (t) => turn(t, 'left'), off: noneToMove },
  { id: 'arrange.flip-horizontal', label: 'Flip horizontal', icon: flipHorizontalIcon, section: 'turn', keywords: ['mirror'], run: (t) => flip(t, 'horizontal'), off: noneToMove },
  { id: 'arrange.flip-vertical', label: 'Flip vertical', icon: flipVerticalIcon, section: 'turn', keywords: ['mirror'], run: (t) => flip(t, 'vertical'), off: noneToMove }
];

/** Each row after the first of a section has a rule above it. */
const separated = (rows: readonly Row[], i: number): boolean => i > 0 && rows[i - 1]!.section !== rows[i]!.section;

// ── the ribbon ──────────────────────────────────────────────────────────────

const entries: MenuEntry<SlidesContext>[] = ARRANGE_ROWS.map((r, i) => ({
  label: r.label,
  icon: r.icon,
  ...(r.shortcut ? { shortcut: r.shortcut } : {}),
  disabled: r.off,
  separated: separated(ARRANGE_ROWS, i),
  run: (c) => {
    r.run(target(c));
    back(c);
  }
}));

const ribbon: RibbonGroup<SlidesContext>[] = [
  {
    id: 'home.arrange',
    tab: 'home',
    // After the drawing group's 500, before Editing's 600.
    order: 520,
    label: 'Arrange',
    items: [{ type: 'menu', id: 'home.arrange', label: 'Arrange', icon: stackIcon, showLabel: true, disabled: readOnly, entries }]
  }
];

const commands: Command<SlidesContext>[] = ARRANGE_ROWS.map((r) => ({
  id: r.id,
  title: r.label,
  section: 'Format',
  icon: r.icon,
  ...(r.shortcut ? { shortcut: r.shortcut } : {}),
  keywords: r.keywords ?? [],
  visible: (c) => c.can.edit,
  disabled: r.off,
  run: (c) => void r.run(target(c))
}));

const keys: SlidesKey[] = ARRANGE_ROWS.filter((r) => r.keys).map((r) => ({
  keys: r.keys!,
  // The slide has the keyboard, and the key would do something; otherwise it is the browser's.
  when: (c) => c.selection.get().focus === 'canvas' && !r.off(c),
  run: (c) => void r.run(target(c))
}));

export const arrangeModule: SlidesModule = { id: 'arrange', ribbon, commands, keys };
