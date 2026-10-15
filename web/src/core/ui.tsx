/**
 * The small pieces every screen is made of beside the controls: an avatar, a
 * dialog, a menu and its popover, a notice, a toast.
 *
 * Dialogs, popovers and toasts move the way README "Motion" says: a dialog scales
 * 95 to 100% over a scrim that fades, a menu or popover rises 4px as it fades in,
 * a toast rises 6px. Each leaves faster than it came, by opacity. The classes that
 * do it are in styles.css; `usePresence` keeps the element long enough to play
 * the exit.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import type { DocKind } from '@shared/api';
import { DUR } from '../motion';
import { usePresence } from '../motion/presence';
import { initialsOf } from './color';
import { Button, IconButton } from './controls';
import {
  Icon,
  infoIcon,
  spinnerGapIcon,
  warningCircleIcon,
  xIcon,
  type PhIcon
} from './icons';

// ── which app this is, for things drawn outside it ──────────────────────────

/**
 * The app a screen belongs to. The colour tokens are set on the editor's root, so
 * anything portalled to `<body>` (a dialog, a toast) would lose them; it reads this
 * instead and wears the same `data-app`. Null is the suite's own accent.
 */
const AppKindContext = createContext<DocKind | null>(null);
export const AppKindProvider = AppKindContext.Provider;
export const useAppKind = (): DocKind | null => useContext(AppKindContext);

// ── avatar ──────────────────────────────────────────────────────────────────

export function Avatar({
  name,
  color,
  size = 28,
  ring = false,
  title,
  className
}: {
  name: string;
  color: string;
  size?: number;
  /** A ring in the surface's colour, so overlapped avatars read as separate. */
  ring?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title ?? name}
      aria-label={name}
      role="img"
      className={className ? `oa-avatar ${className}` : 'oa-avatar'}
      data-ring={ring ? 'true' : undefined}
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        background: color,
        fontSize: Math.max(10, Math.round(size * 0.4))
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

// ── spinner ─────────────────────────────────────────────────────────────────

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span className="oa-spin" style={{ display: 'inline-flex' }} role="status" aria-label="Loading">
      <Icon icon={spinnerGapIcon} size={size} />
    </span>
  );
}

// ── placeholders ────────────────────────────────────────────────────────────

/**
 * A shape where text or a picture will be while it loads. It holds still for 300ms and then
 * pulses in opacity (styles.css), so a quick load shows an outline and nothing that blinks.
 */
export function Bone({ w, h = 10, r, className }: { w: number | string; h?: number; r?: number; className?: string }) {
  return (
    <span
      className={className ? `oa-bone ${className}` : 'oa-bone'}
      aria-hidden="true"
      style={{ width: w, height: h, ...(r === undefined ? {} : { borderRadius: r }) }}
    />
  );
}

/** Rows still to come: a line and a shorter one under it, with a circle where a person's picture goes. */
export function SkeletonRows({ count = 3, avatar = false }: { count?: number; avatar?: boolean }) {
  return (
    <div className="oa-skel-rows" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="oa-skel-row">
          {avatar && <Bone w={32} h={32} r={16} />}
          <span className="oa-skel-row-text">
            <Bone w={`${62 - i * 9}%`} h={11} />
            <Bone w={`${38 + i * 7}%`} h={9} />
          </span>
        </div>
      ))}
    </div>
  );
}

// ── dismissing ──────────────────────────────────────────────────────────────

/** Close on a press outside `root` and on Escape, while `open`. */
export function useDismiss(open: boolean, root: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        close.current();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open, root]);
}

// ── modal ───────────────────────────────────────────────────────────────────

/** Open modals, innermost last. Escape closes the one on top and no other. */
const openModals: symbol[] = [];

const ModalCloseContext = createContext<(() => void) | null>(null);

/** Close the dialog this is inside, with its exit animation. */
export function useModalClose(): () => void {
  const close = useContext(ModalCloseContext);
  if (!close) throw new Error('useModalClose outside a Modal');
  return close;
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog over a scrim, in a portal so no ancestor's `backdrop-filter` or
 * transform can capture its position. Escape and a press on the scrim close it,
 * focus moves in and comes back, and Tab stays inside.
 */
export function Modal({
  title,
  description,
  icon,
  width = 480,
  onClose,
  children,
  footer,
  morph = false
}: {
  title: string;
  description?: React.ReactNode;
  /** A tile at the left of the title: the Lock dialog's padlock. */
  icon?: PhIcon;
  width?: number;
  onClose: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Marks the card as where a view transition from the opening button lands. */
  morph?: boolean;
}) {
  const kind = useAppKind();
  const [open, setOpen] = useState(true);
  const { present, state } = usePresence(open, DUR.fast);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const card = useRef<HTMLDivElement>(null);
  const titleId = useMemo(() => `oa-dlg-${Math.random().toString(36).slice(2, 8)}`, []);

  /** Play the exit, then tell the owner. Asking twice does nothing. */
  const closing = useRef(false);
  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setOpen(false);
    setTimeout(() => closeRef.current(), DUR.fast);
  }, []);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const me = Symbol('modal');
    openModals.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && openModals[openModals.length - 1] === me) {
        e.preventDefault();
        requestClose();
      }
      if (e.key === 'Tab' && openModals[openModals.length - 1] === me && card.current) {
        const found = [...card.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
        const first = found[0];
        const last = found[found.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    // The page behind must not scroll under a dialog.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      openModals.splice(openModals.indexOf(me), 1);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [requestClose]);

  // Focus goes to whatever asked for it (`autoFocus`), else to the card, so a
  // keyboard starts inside the dialog.
  useLayoutEffect(() => {
    if (card.current && !card.current.contains(document.activeElement)) card.current.focus();
  }, []);

  if (!present) return null;

  return createPortal(
    <ModalCloseContext.Provider value={requestClose}>
      <div
        className="oa-scrim"
        data-state={state}
        {...(kind ? { 'data-app': kind } : {})}
        {...(kind === 'slides' ? { 'data-theme': 'dark' } : {})}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) requestClose();
        }}
      >
        <div
          ref={card}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="oa-dialog oa-pop"
          data-state={state}
          {...(morph ? { 'data-morph-target': 'true' } : {})}
          style={{ width }}
        >
          <div className="oa-dialog-head">
            {icon && (
              <span className="oa-dialog-tile">
                <Icon icon={icon} size={19} />
              </span>
            )}
            <h2 id={titleId}>{title}</h2>
            <IconButton icon={xIcon} label="Close" size="md" onClick={requestClose} />
          </div>
          {description && <p className="oa-dialog-desc">{description}</p>}
          <div className="oa-dialog-body">{children}</div>
          {footer && <div className="oa-dialog-foot">{footer}</div>}
        </div>
      </div>
    </ModalCloseContext.Provider>,
    document.body
  );
}

// ── popover and menu ────────────────────────────────────────────────────────

/**
 * A panel that rises under its trigger. Put it, and the trigger, inside one
 * element with `position: relative` (`.oa-pop-wrap`). It is `position: absolute`
 * rather than fixed on purpose: the banner is a `backdrop-filter` panel, and a
 * fixed child of one is positioned against the panel, not the window.
 */
export function Popover({
  open,
  onClose,
  align = 'left',
  role,
  label,
  className,
  children,
  style
}: {
  open: boolean;
  onClose: () => void;
  align?: 'left' | 'right';
  role?: string;
  label?: string;
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const { present, state } = usePresence(open);
  const root = useRef<HTMLDivElement>(null);
  // The wrapper is the panel's parent; a press on the trigger is not "outside".
  const parentRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    parentRef.current = root.current?.parentElement ?? null;
  });
  useDismiss(open, parentRef, onClose);

  if (!present) return null;
  return (
    <div
      ref={root}
      role={role}
      aria-label={label}
      data-state={state}
      data-align={align}
      className={className ? `oa-popover oa-rise ${className}` : 'oa-popover oa-rise'}
      style={style}
    >
      {children}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: PhIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a rule above this item. */
  separated?: boolean;
  shortcut?: string;
}

/** The rows of a menu, with arrow-key movement between them. */
export function MenuList({
  items,
  onDone
}: {
  items: readonly MenuItem[];
  /** Called after an item has run, so the owner can close. */
  onDone: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);

  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const found = list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    if (!found?.length) return;
    e.preventDefault();
    const all = [...found];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? all.length - 1
          : e.key === 'ArrowDown'
            ? (at + 1) % all.length
            : (at - 1 + all.length) % all.length;
    all[next]?.focus();
  };

  return (
    <div ref={list} onKeyDown={move}>
      {items.map((item) => (
        <div key={item.label}>
          {item.separated && <div className="oa-menu-rule" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className="oa-menu-item"
            data-tone={item.danger ? 'danger' : undefined}
            onClick={() => {
              onDone();
              item.onSelect();
            }}
          >
            {item.icon ? <Icon icon={item.icon} size={16} /> : <span className="oa-menu-gap" />}
            <span className="oa-menu-label">{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        </div>
      ))}
    </div>
  );
}

export function Menu({
  label,
  items,
  icon,
  align = 'right',
  trigger
}: {
  /** The trigger's accessible name. */
  label: string;
  items: readonly MenuItem[];
  icon: PhIcon;
  align?: 'left' | 'right';
  /** A trigger of your own, given what it needs. Default: an icon button. */
  trigger?: (props: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // A keyboard that opened the menu lands on its first item.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      if (document.activeElement === button.current) {
        button.current?.parentElement?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  return (
    <div
      className="oa-pop-wrap"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      {trigger ? (
        trigger({ open, toggle, ref: button })
      ) : (
        <IconButton
          ref={button}
          icon={icon}
          label={label}
          size="sm"
          active={open}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        />
      )}
      <Popover open={open} onClose={close} align={align} role="menu" label={label}>
        <MenuList items={items} onDone={close} />
      </Popover>
    </div>
  );
}

// ── notice ──────────────────────────────────────────────────────────────────

const TONES = {
  info: { icon: infoIcon },
  warning: { icon: warningCircleIcon },
  danger: { icon: warningCircleIcon }
} as const;

/** A sentence above or inside a region. Warning and danger are tints, not fills,
 *  so they read on glass and on paper without a second set of colours. */
export function Banner({
  tone = 'info',
  children,
  action
}: {
  tone?: keyof typeof TONES;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className="oa-notice" data-tone={tone}>
      <Icon icon={TONES[tone].icon} size={18} className="oa-notice-icon" />
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {action}
    </div>
  );
}

// ── toasts ──────────────────────────────────────────────────────────────────

export interface Toast {
  text: string;
  tone?: 'info' | 'danger';
  /** A single follow-up, such as "Undo". Taking it dismisses the toast. */
  action?: { label: string; run: () => void };
}

const ToastCtx = createContext<((t: Toast) => void) | null>(null);

/** Say something short and let it go. The same text twice replaces itself. */
export function useNotify(): (t: Toast) => void {
  const notify = useContext(ToastCtx);
  if (!notify) throw new Error('useNotify outside ToastHost');
  return notify;
}

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<(Toast & { n: number }) | null>(null);
  const [open, setOpen] = useState(false);
  const { present, state } = usePresence(open, DUR.fast);
  const counter = useRef(0);
  const kind = useAppKind();

  const notify = useCallback((t: Toast) => {
    setToast({ ...t, n: ++counter.current });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!toast || !open) return;
    // A toast with an action stays long enough to be reached.
    const id = setTimeout(() => setOpen(false), toast.action ? 9000 : 4500);
    return () => clearTimeout(id);
  }, [toast, open]);

  useEffect(() => {
    if (!present) setToast(null);
  }, [present]);

  return (
    <ToastCtx.Provider value={notify}>
      {children}
      {toast && present && (
        <div
          key={toast.n}
          role={toast.tone === 'danger' ? 'alert' : 'status'}
          className="oa-toast"
          data-state={state}
          data-tone={toast.tone}
          {...(kind ? { 'data-app': kind } : {})}
        >
          <span style={{ flex: 1 }}>{toast.text}</span>
          {toast.action && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                toast.action?.run();
                setOpen(false);
              }}
            >
              {toast.action.label}
            </Button>
          )}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

// ── small layout helpers ────────────────────────────────────────────────────

/** Copy text to the clipboard. False when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
