/**
 * The ribbon: a tab row, and the strip of the chosen tab.
 *
 * It draws whatever the modules contributed (types.ts) and knows nothing about the
 * editor beneath it. What it does itself:
 *
 *   tabs         arrow keys move between them and choose, the underline slides to
 *                the active one, and the strip's groups cross-fade with a 4px rise
 *   the strip    one tab stop (roving tabindex), arrow keys between its controls,
 *                and the controls: tool and toggle buttons, split buttons, menus,
 *                selects, a style gallery and a colour picker
 *   collapse     the chevron at the right hides the strip; a tab clicked while it is
 *                collapsed shows it until a command runs or the pointer goes away
 *
 * The state a control shows (pressed, disabled, its value) is computed from the
 * context by the registry, and the strip re-reads it only when `subscribe` says the
 * editor's state moved. A keystroke therefore does not re-render thirty buttons.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { DUR } from '../../motion';
import { useIndicator } from '../controls';
import { caretDownIcon, caretUpIcon, checkIcon, dotsThreeIcon, Icon } from '../icons';
import { Menu, MenuList, Popover, useDismiss, type MenuItem as UiMenuItem } from '../ui';
import { groupsFor, itemStates, sortedModes, statesEqual, visibleTabs, type ItemState } from './registry';
import type {
  ButtonItem,
  ColorItem,
  EditingMode,
  GalleryItem,
  MenuEntry,
  MenuItem,
  RibbonGroup,
  RibbonItem,
  SelectItem,
  SplitItem,
  TabDef
} from './types';

// ── state ───────────────────────────────────────────────────────────────────

/**
 * Each shown item's state, kept current. `subscribe` calls back when something the
 * predicates read has changed; the states are recomputed then (coalesced to one per
 * frame) and the strip re-renders only if one actually differs.
 */
function useItemStates<C>(
  items: readonly RibbonItem<C>[],
  ctx: C,
  subscribe: (cb: () => void) => () => void
): ReadonlyMap<string, ItemState> {
  const latest = useRef({ items, ctx });
  latest.current = { items, ctx };
  const [states, setStates] = useState(() => itemStates(items, ctx));

  const refresh = useCallback(() => {
    setStates((prev) => {
      const next = itemStates(latest.current.items, latest.current.ctx);
      return statesEqual(prev, next) ? prev : next;
    });
  }, []);

  // A new context or item list is read at once; an editor event waits for a frame.
  useLayoutEffect(refresh, [items, ctx, refresh]);
  useEffect(() => {
    let frame = 0;
    const off = subscribe(() => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          refresh();
        });
      }
    });
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [subscribe, refresh]);

  return states;
}

const OFF: ItemState = { active: false, disabled: false, value: null };

const tip = (label: string, shortcut?: string): string => (shortcut ? `${label} (${shortcut})` : label);

// ── controls ────────────────────────────────────────────────────────────────

interface RunProps<C> {
  ctx: C;
  state: ItemState;
  /** Called after a command has run, so a peeking strip can put itself away. */
  done: () => void;
}

function ToolButton<C>({ item, ctx, state, done }: RunProps<C> & { item: ButtonItem<C> }) {
  return (
    <button
      type="button"
      data-rb-item
      data-id={item.id}
      className={item.showLabel ? 'oa-rb-tl' : 'oa-rb-tb'}
      aria-label={item.label}
      title={tip(item.label, item.shortcut)}
      disabled={state.disabled}
      {...(item.active ? { 'aria-pressed': state.active } : {})}
      onMouseDown={keepSelection}
      onClick={() => {
        item.run(ctx);
        done();
      }}
    >
      {item.icon && <Icon icon={item.icon} size={16} />}
      {item.showLabel && item.label}
    </button>
  );
}

/** A press on a ribbon button must not take focus from the page, or the selection
 *  the command is about to act on is lost with it. The keyboard still focuses. */
function keepSelection(e: React.MouseEvent): void {
  e.preventDefault();
}

/** A menu's rows from the strip's entries, with their state read now. */
function entriesToRows<C>(entries: readonly MenuEntry<C>[], ctx: C, close: () => void): UiMenuItem[] {
  return entries
    .filter((e) => e.visible?.(ctx) ?? true)
    .map((e) => ({
      label: e.label,
      ...(e.icon ? { icon: e.icon } : e.active?.(ctx) ? { icon: checkIcon } : {}),
      ...(e.shortcut ? { shortcut: e.shortcut } : {}),
      onSelect: () => {
        e.run(ctx);
        close();
      },
      disabled: e.disabled?.(ctx) ?? false,
      danger: e.danger ?? false,
      separated: e.separated ?? false
    }));
}

/** The shared shell of a control that opens a popover under itself. */
function useOpen() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return { open, setOpen, close, toggle: () => setOpen((v) => !v) };
}

function SplitButton<C>({ item, ctx, state, done }: RunProps<C> & { item: SplitItem<C> }) {
  const o = useOpen();
  return (
    <span className="oa-pop-wrap oa-rb-split">
      <button
        type="button"
        data-rb-item
        data-id={item.id}
        className={item.showLabel ? 'oa-rb-tl' : 'oa-rb-tb'}
        aria-label={item.label}
        title={tip(item.label, item.shortcut)}
        disabled={state.disabled}
        {...(item.active ? { 'aria-pressed': state.active } : {})}
        onMouseDown={keepSelection}
        onClick={() => {
          item.run(ctx);
          done();
        }}
      >
        {item.icon && <Icon icon={item.icon} size={16} />}
        {item.showLabel && item.label}
      </button>
      <button
        type="button"
        data-rb-item
        data-id={`${item.id}.more`}
        className="oa-rb-chev"
        aria-label={`${item.label}, more`}
        aria-haspopup="menu"
        aria-expanded={o.open}
        disabled={state.disabled}
        onMouseDown={keepSelection}
        onClick={o.toggle}
      >
        <Icon icon={caretDownIcon} size={11} />
      </button>
      <Popover open={o.open} onClose={o.close} role="menu" label={item.label}>
        <MenuList items={entriesToRows(item.menu, ctx, () => (o.close(), done()))} onDone={o.close} />
      </Popover>
    </span>
  );
}

function MenuButton<C>({ item, ctx, state, done }: RunProps<C> & { item: MenuItem<C> }) {
  const o = useOpen();
  return (
    <span className="oa-pop-wrap">
      <button
        type="button"
        data-rb-item
        data-id={item.id}
        className="oa-rb-tl"
        aria-label={item.showLabel ? undefined : item.label}
        title={tip(item.label, item.shortcut)}
        aria-haspopup="menu"
        aria-expanded={o.open}
        disabled={state.disabled}
        onMouseDown={keepSelection}
        onClick={o.toggle}
      >
        {item.icon && <Icon icon={item.icon} size={16} />}
        {item.showLabel && item.label}
        <Icon icon={caretDownIcon} size={11} className="oa-rb-cv" />
      </button>
      <Popover open={o.open} onClose={o.close} role="menu" label={item.label}>
        <MenuList items={entriesToRows(item.entries, ctx, () => (o.close(), done()))} onDone={o.close} />
      </Popover>
    </span>
  );
}

/** A dropdown that shows its value: the font and its size. */
function SelectControl<C>({ item, ctx, state, done }: RunProps<C> & { item: SelectItem<C> }) {
  const o = useOpen();
  const current = item.options.find((x) => x.value === state.value);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (o.open) list.current?.querySelector<HTMLElement>('[aria-selected="true"], [role="option"]')?.focus();
  }, [o.open]);

  const choose = (value: string) => {
    item.run(ctx, value);
    o.close();
    done();
  };

  const moveInList = (e: React.KeyboardEvent) => {
    const opts = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = opts.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      opts[(at + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length]?.focus();
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      o.close();
    }
  };

  return (
    <span className="oa-pop-wrap">
      <button
        type="button"
        data-rb-item
        data-id={item.id}
        className="oa-rb-dd"
        style={{ width: item.width }}
        aria-label={item.label}
        title={item.label}
        aria-haspopup="listbox"
        aria-expanded={o.open}
        disabled={state.disabled}
        onMouseDown={keepSelection}
        onClick={o.toggle}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !o.open) {
            e.preventDefault();
            o.setOpen(true);
          }
        }}
      >
        <span className="oa-ellipsis" style={current?.style}>
          {current?.label ?? state.value ?? ''}
        </span>
        <Icon icon={caretDownIcon} size={11} className="oa-rb-cv" />
      </button>
      <Popover open={o.open} onClose={o.close} role="presentation">
        <div ref={list} role="listbox" aria-label={item.label} onKeyDown={moveInList} className="oa-rb-list">
          {item.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === state.value}
              className="oa-menu-item"
              style={opt.style}
              onClick={() => choose(opt.value)}
            >
              <span className="oa-menu-label">{opt.label}</span>
              {opt.value === state.value && <Icon icon={checkIcon} size={14} />}
            </button>
          ))}
        </div>
      </Popover>
    </span>
  );
}

/** The named styles, laid out in a row the way Word's gallery is. */
function GalleryControl<C>({ item, ctx, state, done }: RunProps<C> & { item: GalleryItem<C> }) {
  return (
    <span role="listbox" aria-label={item.label} className="oa-rb-gallery">
      {item.entries.map((e) => (
        <button
          key={e.value}
          type="button"
          role="option"
          data-rb-item
          data-id={`${item.id}.${e.value}`}
          aria-selected={e.value === state.value}
          className="oa-rb-sty"
          style={e.style}
          disabled={state.disabled}
          onMouseDown={keepSelection}
          onClick={() => {
            item.run(ctx, e.value);
            done();
          }}
        >
          {e.label}
        </button>
      ))}
    </span>
  );
}

/** A colour: the letter over a bar of the current colour, and the palette under it. */
function ColorControl<C>({ item, ctx, state, done }: RunProps<C> & { item: ColorItem<C> }) {
  const o = useOpen();
  const pick = (c: string | null) => {
    item.run(ctx, c);
    o.close();
    done();
  };
  return (
    <span className="oa-pop-wrap">
      <button
        type="button"
        data-rb-item
        data-id={item.id}
        className="oa-rb-tb oa-rb-color"
        aria-label={item.label}
        title={tip(item.label, item.shortcut)}
        aria-haspopup="true"
        aria-expanded={o.open}
        disabled={state.disabled}
        onMouseDown={keepSelection}
        onClick={o.toggle}
      >
        {item.icon ? <Icon icon={item.icon} size={16} /> : <span className="oa-rb-glyph">{item.glyph ?? 'A'}</span>}
        <span className="oa-rb-bar" style={{ background: state.value ?? 'var(--fg-1)' }} />
      </button>
      <Popover open={o.open} onClose={o.close} role="dialog" label={item.label}>
        <div className="oa-rb-palette" role="group" aria-label={item.label}>
          {item.palette.map((s) => (
            <button
              key={s.value}
              type="button"
              className="oa-rb-swatch"
              aria-label={s.label}
              title={s.label}
              aria-pressed={s.value === state.value}
              style={{ background: s.value }}
              onClick={() => pick(s.value)}
            />
          ))}
        </div>
        <button type="button" className="oa-menu-item" onClick={() => pick(null)}>
          <span className="oa-menu-label">{item.clearLabel ?? 'No colour'}</span>
        </button>
      </Popover>
    </span>
  );
}

function Item<C>({ item, ctx, state, done }: RunProps<C> & { item: RibbonItem<C> }) {
  switch (item.type) {
    case 'separator':
      return <span className="oa-rb-sep" aria-hidden="true" />;
    case 'button':
      return <ToolButton item={item} ctx={ctx} state={state} done={done} />;
    case 'split':
      return <SplitButton item={item} ctx={ctx} state={state} done={done} />;
    case 'menu':
      return <MenuButton item={item} ctx={ctx} state={state} done={done} />;
    case 'select':
      return <SelectControl item={item} ctx={ctx} state={state} done={done} />;
    case 'gallery':
      return <GalleryControl item={item} ctx={ctx} state={state} done={done} />;
    case 'color':
      return <ColorControl item={item} ctx={ctx} state={state} done={done} />;
    case 'custom':
      return <>{item.render(ctx)}</>;
  }
}

// ── the strip ───────────────────────────────────────────────────────────────

function StripContent<C>({
  groups,
  ctx,
  states,
  done,
  more = false,
  rows = false
}: {
  groups: RibbonGroup<C>[];
  ctx: C;
  states: ReadonlyMap<string, ItemState>;
  done: () => void;
  /** More follows the last group, so it has a rule after it too. */
  more?: boolean;
  /** The groups under More: one to a row, with no rules between them. */
  rows?: boolean;
}) {
  return (
    <>
      {groups.map((g, i) => (
        <span key={g.id} role="group" aria-label={g.label} className="oa-rb-group" data-group={g.id}>
          {g.items.map((item) => (
            <Item key={item.id} item={item} ctx={ctx} state={states.get(item.id) ?? OFF} done={done} />
          ))}
          {!rows && (i < groups.length - 1 || more) && <span className="oa-rb-sep" aria-hidden="true" />}
        </span>
      ))}
    </>
  );
}

/** The More button's width with the gap before it, kept free once a group has to go under it. */
const MORE_WIDTH = 32;

/** How many groups, from the first, fit in `room`. When not all of them do, `more` is kept for More. */
export function fitGroups(widths: readonly number[], room: number, more: number): number {
  if (widths.reduce((a, w) => a + w, 0) <= room) return widths.length;
  let used = more;
  let n = 0;
  while (n < widths.length && used + widths[n]! <= room) used += widths[n++]!;
  return n;
}

interface Fit {
  /** The buttons that have an icon show only it (`data-compact`). */
  compact: boolean;
  /** How many groups are on the strip; the rest are under More. */
  n: number;
}

/**
 * The strip is one row, so the ribbon is the same height on every tab and at every width. Short of
 * room, the buttons with an icon drop their words first, as Office's do; then the groups that still
 * do not fit go under More, from the last. A group is measured in each form while it is drawn and
 * remembered while it is not; a new set of groups is drawn whole and measured before paint.
 */
function useFit<C>(el: HTMLElement | null, groups: readonly RibbonGroup<C>[]): Fit {
  const key = groups.map((g) => `${g.id}:${g.items.map((i) => i.id).join(',')}`).join('|');
  const widths = useRef({ key: '', wide: new Map<string, number>(), compact: new Map<string, number>() });
  const [fit, setFit] = useState<Fit & { key: string }>({ key: '', compact: false, n: 0 });
  const latest = useRef({ groups, key });
  latest.current = { groups, key };

  const measure = useCallback(() => {
    if (!el?.isConnected) return;
    const { groups, key } = latest.current;
    const w = widths.current;
    if (w.key !== key) Object.assign(w, { key, wide: new Map(), compact: new Map() });
    const cs = getComputedStyle(el);
    const gap = parseFloat(cs.columnGap) || 0;
    const room = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) + gap;
    const drawn = el.hasAttribute('data-compact') ? w.compact : w.wide;
    for (const g of el.children) {
      const id = (g as HTMLElement).dataset.group;
      if (id) drawn.set(id, g.getBoundingClientRect().width + gap);
    }
    const all = groups.length;
    const sizes = (m: Map<string, number>) => groups.map((g) => m.get(g.id));
    const wide = sizes(w.wide);
    const compact = sizes(w.compact);
    const known = (xs: (number | undefined)[]): xs is number[] => xs.every((x) => x !== undefined);
    const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
    const next: Fit =
      // A strip with no width has no layout (a hidden page, or a test): it draws everything.
      room <= gap || !known(wide) || sum(wide) <= room
        ? { compact: false, n: all }
        : !known(compact)
          ? { compact: true, n: all }
          : { compact: true, n: fitGroups(compact, room, MORE_WIDTH) };
    setFit((f) => (f.key === key && f.compact === next.compact && f.n === next.n ? f : { key, ...next }));
  }, [el]);

  const now: Fit = fit.key === key ? fit : { compact: false, n: groups.length };
  // Each new form is drawn, then measured, until one fits: at most three passes, all before paint.
  useLayoutEffect(measure, [key, measure, now.compact, now.n]);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const g of el.children) if ((g as HTMLElement).dataset.group) ro.observe(g);
    return () => ro.disconnect();
  }, [el, measure, key, now.compact, now.n]);
  return now;
}

/** The groups that did not fit, under a button at the end of the strip. */
function MoreButton<C>({ groups, ctx, states, done }: { groups: RibbonGroup<C>[]; ctx: C; states: ReadonlyMap<string, ItemState>; done: () => void }) {
  const o = useOpen();
  const ran = () => {
    o.close();
    done();
  };
  return (
    <span className="oa-pop-wrap">
      <button
        type="button"
        data-rb-item
        data-id="ribbon.more"
        className="oa-rb-tb"
        aria-label="More"
        title="More"
        aria-haspopup="dialog"
        aria-expanded={o.open}
        onMouseDown={keepSelection}
        onClick={o.toggle}
      >
        <Icon icon={dotsThreeIcon} size={16} />
      </button>
      <Popover open={o.open} onClose={o.close} align="right" role="dialog" label="More">
        <div
          className="oa-rb-more"
          // A control drawn by a module does not say when it has run; one that opens nothing has.
          onClick={(e) => {
            const pressed = (e.target as HTMLElement).closest('[data-rb-item]');
            if (pressed && !pressed.hasAttribute('aria-haspopup')) ran();
          }}
        >
          <StripContent groups={groups} ctx={ctx} states={states} done={ran} rows />
        </div>
      </Popover>
    </span>
  );
}

/** The strip's own controls: not those in a menu or under More, which Tab reaches in their panel. */
const stripItems = (root: HTMLElement | null): HTMLElement[] =>
  [...(root?.querySelectorAll<HTMLElement>('[data-rb-item]') ?? [])].filter((n) => !n.closest('.oa-popover'));

/** One tab stop for the whole strip; the arrows move inside it. */
function useRoving(strip: React.RefObject<HTMLElement | null>, tab: string) {
  const current = useRef<string | null>(null);

  useLayoutEffect(() => {
    current.current = null;
  }, [tab]);

  // Every render, because the controls under it do.
  useLayoutEffect(() => {
    const root = strip.current;
    if (!root) return;
    const all = stripItems(root);
    const keep = all.find((n) => n.dataset.id === current.current && !(n as HTMLButtonElement).disabled) ?? all.find((n) => !(n as HTMLButtonElement).disabled);
    for (const n of all) n.tabIndex = n === keep ? 0 : -1;
  });

  const onFocus = (e: React.FocusEvent) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-rb-item]')?.dataset.id;
    if (id) current.current = id;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // A key meant for an open menu or list, or for a field, is not ours.
    if ((e.target as HTMLElement).closest('.oa-popover, input, textarea')) return;
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const all = stripItems(strip.current).filter((n) => !(n as HTMLButtonElement).disabled);
    if (!all.length) return;
    const at = all.findIndex((n) => n === (e.target as HTMLElement).closest('[data-rb-item]'));
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
    e.preventDefault();
    all[next]?.focus();
  };

  return { onFocus, onKeyDown };
}

// ── the tab row and the strip together ──────────────────────────────────────

export interface RibbonProps<C> {
  tabs: readonly TabDef[];
  groups: readonly RibbonGroup<C>[];
  ctx: C;
  active: string;
  onActive: (id: string) => void;
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
  /** The File tab's popover content. */
  fileMenu: React.ReactNode;
  /** The "Editing" menu at the right of the tab row. */
  modeSlot?: React.ReactNode;
  /** Calls back when the state the controls read has changed. */
  subscribe: (cb: () => void) => () => void;
}

export function Ribbon<C>(props: RibbonProps<C>) {
  const { tabs, groups, ctx, onActive, collapsed, onCollapsed, fileMenu, modeSlot, subscribe } = props;
  const shownTabs = useMemo(() => visibleTabs(tabs, groups, ctx), [tabs, groups, ctx]);
  const choices = shownTabs.filter((t) => t.id !== 'file');
  const active = choices.some((t) => t.id === props.active) ? props.active : (choices[0]?.id ?? '');

  const [fileOpen, setFileOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const indicator = useIndicator<HTMLDivElement>(active, 'x', [choices.length]);

  // The strip that is leaving, held for the length of its fade.
  const [shown, setShown] = useState(active);
  const [leaving, setLeaving] = useState<string | null>(null);
  useEffect(() => {
    if (shown === active) return;
    setLeaving(shown);
    setShown(active);
    const id = setTimeout(() => setLeaving(null), DUR.fast);
    return () => clearTimeout(id);
  }, [active, shown]);

  const stripGroups = useMemo(() => groupsFor(groups, shown, ctx), [groups, shown, ctx]);
  const leavingGroups = useMemo(() => (leaving ? groupsFor(groups, leaving, ctx) : []), [groups, leaving, ctx]);
  const allItems = useMemo(() => stripGroups.flatMap((g) => g.items), [stripGroups]);
  const states = useItemStates(allItems, ctx, subscribe);
  const leavingStates = useItemStates(
    useMemo(() => leavingGroups.flatMap((g) => g.items), [leavingGroups]),
    ctx,
    subscribe
  );

  const roving = useRoving(strip, shown);
  const open = !collapsed || peek;

  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const fit = useFit(content, stripGroups);
  // The leaving strip keeps the form it had, for the length of its fade.
  const fits = useRef(new Map<string, Fit>());
  fits.current.set(shown, fit);
  const leavingFit = (leaving && fits.current.get(leaving)) || { compact: false, n: leavingGroups.length };

  // A peeking strip goes away when the pointer goes elsewhere, or a command ran.
  const pastRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    pastRef.current = rowRef.current?.parentElement ?? null;
  });
  useDismiss(collapsed && peek, pastRef, () => setPeek(false));
  const done = useCallback(() => setPeek(false), []);

  const onTabKeys = (e: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const at = choices.findIndex((t) => t.id === active);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + choices.length) % choices.length;
    const target = choices[next];
    if (!target) return;
    e.preventDefault();
    onActive(target.id);
    requestAnimationFrame(() => indicator.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(target.id)}"]`)?.focus());
  };

  const tabLabel = shownTabs.find((t) => t.id === shown)?.label ?? 'Ribbon';
  const hasFile = shownTabs.some((t) => t.id === 'file');

  return (
    <>
      <div ref={rowRef} className="oa-rb-tabs">
        {hasFile && (
          <span className="oa-pop-wrap">
            <button
              type="button"
              className="oa-rb-tab"
              aria-haspopup="menu"
              aria-expanded={fileOpen}
              onClick={() => setFileOpen((v) => !v)}
            >
              File
            </button>
            <Popover open={fileOpen} onClose={() => setFileOpen(false)} role="menu" label="File" className="oa-file-menu">
              <div onClick={() => setFileOpen(false)}>{fileMenu}</div>
            </Popover>
          </span>
        )}
        <div ref={indicator} role="tablist" aria-label="Ribbon" className="oa-rb-tablist" onKeyDown={onTabKeys}>
          {choices.map((t) => (
            <button
              key={t.id}
              id={`oa-tab-${t.id}`}
              type="button"
              role="tab"
              data-key={t.id}
              aria-selected={t.id === active}
              aria-controls="oa-ribbon-strip"
              tabIndex={t.id === active ? 0 : -1}
              className="oa-rb-tab"
              onClick={() => {
                onActive(t.id);
                if (collapsed) setPeek(true);
              }}
            >
              {t.label}
            </button>
          ))}
          <span className="oa-ind oa-ind-x" aria-hidden="true" />
        </div>
        <span style={{ flex: 1 }} />
        {modeSlot}
        <button
          type="button"
          className="oa-rb-tb"
          aria-label={collapsed ? 'Expand the ribbon' : 'Collapse the ribbon'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand the ribbon' : 'Collapse the ribbon'}
          onClick={() => {
            setPeek(false);
            onCollapsed(!collapsed);
          }}
        >
          <Icon icon={collapsed ? caretDownIcon : caretUpIcon} size={16} />
        </button>
      </div>

      {open && choices.length > 0 && (
        <div
          ref={strip}
          id="oa-ribbon-strip"
          role="toolbar"
          aria-label={tabLabel}
          aria-labelledby={`oa-tab-${shown}`}
          className={collapsed ? 'oa-rb-strip glass' : 'oa-rb-strip'}
          data-peek={collapsed ? 'true' : undefined}
          {...roving}
        >
          <div key={shown} ref={setContent} className="oa-rb-content oa-rise" data-compact={fit.compact ? '' : undefined}>
            <StripContent groups={stripGroups.slice(0, fit.n)} ctx={ctx} states={states} done={done} more={fit.n < stripGroups.length} />
            {fit.n < stripGroups.length && <MoreButton groups={stripGroups.slice(fit.n)} ctx={ctx} states={states} done={done} />}
          </div>
          {leaving && (
            <div className="oa-rb-content oa-rb-leaving" aria-hidden="true" data-compact={leavingFit.compact ? '' : undefined} {...{ inert: '' }}>
              <StripContent groups={leavingGroups.slice(0, leavingFit.n)} ctx={ctx} states={leavingStates} done={done} more={leavingFit.n < leavingGroups.length} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── the editing mode menu ───────────────────────────────────────────────────

/**
 * "Editing ⌄" at the right of the tab row. With one mode (a reader who cannot edit)
 * it is a label; with several it is a menu.
 */
export function EditingModeMenu({
  modes,
  mode,
  onMode
}: {
  modes: readonly EditingMode[];
  mode: string;
  onMode: (id: string) => void;
}) {
  const sorted = sortedModes(modes);
  const current = sorted.find((m) => m.id === mode) ?? sorted[0];
  if (!current) return null;

  if (sorted.length < 2) {
    return (
      <span className="oa-rb-tl oa-rb-static" style={{ fontWeight: 600 }}>
        {current.icon && <Icon icon={current.icon} size={16} />}
        {current.label}
      </span>
    );
  }

  return (
    <Menu
      label="Editing mode"
      icon={caretDownIcon}
      align="right"
      items={sorted.map((m) => ({
        label: m.label,
        ...(m.icon ? { icon: m.icon } : {}),
        onSelect: () => onMode(m.id)
      }))}
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref}
          type="button"
          className="oa-rb-tl"
          style={{ fontWeight: 600 }}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Editing mode, ${current.label}`}
          onClick={toggle}
        >
          {current.icon && <Icon icon={current.icon} size={16} />}
          {current.label}
          <Icon icon={caretDownIcon} size={11} className="oa-rb-cv" />
        </button>
      )}
    />
  );
}
