/**
 * The dropdown behind `Select`: a button that shows the value, and a listbox in a popover.
 *
 * The browser draws a native select's popup itself, outside the page, and on some machines draws it
 * wrongly over a dialog. This one is the page's own: a portal on `<body>` (so no dialog's overflow can
 * clip it), `position: fixed` from the button's rectangle (`placement.ts`: below it, above it when
 * there is no room), themed from the tokens, and moved by `transform` and `opacity` only.
 *
 * It is the select-only combobox of the ARIA practices guide. Focus never leaves the button; the
 * option being pointed at is `aria-activedescendant`, so a screen reader hears the list while the
 * keyboard stays where it was and Escape has nowhere to return to but the button it never left.
 *
 *   closed   ArrowDown, ArrowUp, Enter, Space, Home, End open it; a letter opens it on the first match
 *   open     arrows, Home, End, PageUp, PageDown move; Enter and Space choose; Escape closes (and is the
 *            dropdown's, not the dialog's); Tab chooses what is pointed at and moves on; letters type ahead
 *   pointer  a press outside closes it; hover points; a click chooses
 *
 * A disabled option is never pointed at and never chosen. The chosen option is scrolled into view when
 * it opens, and the pointed one as it moves.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from '../motion/presence';
import { checkIcon, Icon } from './icons';
import { placeBelow, type Placed } from './placement';
import { scopeOf } from './popupScope';
import { createTypeahead, isTypeaheadKey } from './typeahead';
import './popup.css';

export interface ListboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ListboxProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'onChange' | 'id' | 'className'> {
  id: string;
  value: string;
  options: readonly ListboxOption[];
  onChange: (value: string) => void;
  /** The list's accessible name: the field's label. */
  name?: string;
}

const PAGE = 10;

export function Listbox({ id, value, options, onChange, name, disabled, onKeyDown, onBlur, ...rest }: ListboxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<(Placed & { minWidth: number }) | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const typeahead = useRef(createTypeahead());
  const { present, state } = usePresence(open);

  const selected = options.findIndex((o) => o.value === value);
  const labels = useMemo(() => options.map((o) => o.label), [options]);
  const usable = (i: number): boolean => options[i] !== undefined && !options[i]!.disabled;
  const firstUsable = (): number => options.findIndex((_, i) => usable(i));
  const lastUsable = (): number => {
    for (let i = options.length - 1; i >= 0; i--) if (usable(i)) return i;
    return -1;
  };
  /** The next usable option from `from`, `by` places away; it stays where it is at the end of the list. */
  const move = (from: number, dir: 1 | -1, by = 1): number => {
    let at = from;
    for (let n = 0; n < by; n++) {
      let i = at + dir;
      while (i >= 0 && i < options.length && !usable(i)) i += dir;
      if (i < 0 || i >= options.length) break;
      at = i;
    }
    return at;
  };

  const show = (at?: number): void => {
    if (disabled || options.length === 0) return;
    typeahead.current.reset();
    setActive(at ?? (selected >= 0 && usable(selected) ? selected : firstUsable()));
    setOpen(true);
  };

  const choose = (i: number, refocus = true): void => {
    const o = options[i];
    setOpen(false);
    if (refocus) btn.current?.focus({ preventScroll: true });
    if (o && !o.disabled && o.value !== value) onChange(o.value);
  };

  const keys = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    onKeyDown?.(e);
    if (e.defaultPrevented || disabled) return;
    const k = e.key;
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') {
        e.preventDefault();
        show();
      } else if (k === 'Home' || k === 'End') {
        e.preventDefault();
        show(k === 'Home' ? firstUsable() : lastUsable());
      } else if (isTypeaheadKey(e)) {
        const i = typeahead.current.type(k, labels, selected, usable);
        if (i >= 0) {
          e.preventDefault();
          show(i);
        }
      }
      return;
    }
    switch (k) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => move(a, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => move(a, -1));
        break;
      case 'PageDown':
        e.preventDefault();
        setActive((a) => move(a, 1, PAGE));
        break;
      case 'PageUp':
        e.preventDefault();
        setActive((a) => move(a, -1, PAGE));
        break;
      case 'Home':
        e.preventDefault();
        setActive(firstUsable());
        break;
      case 'End':
        e.preventDefault();
        setActive(lastUsable());
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(active);
        break;
      case 'Escape':
        // The dropdown's Escape: a dialog around it must not close as well.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        break;
      case 'Tab':
        // The choice is made and the keyboard goes on to the next field.
        choose(active, false);
        break;
      default:
        if (isTypeaheadKey(e)) {
          const i = typeahead.current.type(k, labels, active, usable);
          if (i >= 0) setActive(i);
        }
    }
  };

  // A press outside the button and the list closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  // Under the button, or over it; and again when the window or anything that scrolls under it moves.
  const place = useCallback(() => {
    const b = btn.current;
    const l = list.current;
    if (!b || !l) return;
    const anchor = b.getBoundingClientRect();
    setPos({ ...placeBelow(anchor, { w: l.offsetWidth, h: l.scrollHeight }, { width: window.innerWidth, height: window.innerHeight }), minWidth: anchor.width });
  }, []);
  useLayoutEffect(() => {
    if (present) place();
  }, [present, place, options]);
  useEffect(() => {
    if (!open) return;
    // Scrolling the list itself moves nothing it hangs from.
    const again = (e?: Event) => {
      if (e?.target instanceof Node && list.current?.contains(e.target)) return;
      place();
    };
    window.addEventListener('resize', again);
    document.addEventListener('scroll', again, true);
    return () => {
      window.removeEventListener('resize', again);
      document.removeEventListener('scroll', again, true);
    };
  }, [open, place]);

  // The option being pointed at is in view: the chosen one as it opens, and each as the keys move.
  useLayoutEffect(() => {
    if (!open || active < 0) return;
    const el = list.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, pos]);

  const current = selected >= 0 ? options[selected] : undefined;

  return (
    <>
      <button
        {...rest}
        ref={btn}
        id={id}
        type="button"
        role="combobox"
        className="oa-select-btn"
        data-value={value}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={present ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        onClick={(e) => {
          rest.onClick?.(e);
          if (open) setOpen(false);
          else show();
        }}
        onKeyDown={keys}
        // Space clicks a button when it is let go; the key was already taken on the way down.
        onKeyUp={(e) => {
          rest.onKeyUp?.(e);
          if (e.key === ' ') e.preventDefault();
        }}
        onBlur={(e) => {
          onBlur?.(e);
          if (!list.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <span className="oa-select-value">{current?.label ?? ''}</span>
      </button>
      {present &&
        createPortal(
          <div className="oa-ctx-root" {...scopeOf(btn.current)}>
            <div
              ref={list}
              id={listId}
              role="listbox"
              aria-label={name}
              data-state={state}
              className="oa-pop-panel oa-listbox oa-rise"
              style={{
                left: pos?.left ?? -9999,
                top: pos?.top ?? -9999,
                maxHeight: pos?.maxHeight,
                minWidth: pos?.minWidth,
                ...(pos ? {} : { visibility: 'hidden' as const })
              }}
              // The list never takes the focus from the button.
              onMouseDown={(e) => e.preventDefault()}
            >
              {options.map((o, i) => (
                <div
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  data-value={o.value}
                  aria-selected={i === selected}
                  aria-disabled={o.disabled || undefined}
                  data-active={i === active || undefined}
                  className="oa-opt"
                  onPointerEnter={() => usable(i) && setActive(i)}
                  onClick={() => usable(i) && choose(i)}
                >
                  <span className="oa-opt-label">{o.label}</span>
                  {i === selected && <Icon icon={checkIcon} size={14} className="oa-opt-check" />}
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
