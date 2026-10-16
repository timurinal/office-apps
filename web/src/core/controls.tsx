/**
 * The controls every screen is made of: buttons, fields, a select, a switch, chips
 * and tabs.
 *
 * Drawn from the approved boards (docs/design/boards) and nothing else: 32px
 * buttons at radius 8, 30px tool buttons at radius 6, a 36 or 40px field on the
 * sunken tone, a 34 by 20 switch. The look lives in styles.css under `.oa-*` so
 * hover, pressed and focus states are CSS; a component only chooses which class
 * and data attribute to wear. The colour is the app's: `--app-*`, set per editor
 * and violet on Home, so none of these knows which app it is in.
 *
 * Nothing here comes from the design system's bundle. That bundle was a 200 KB
 * script the whole app waited for before it painted, drawn to a different set of
 * measurements than the boards.
 */

import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { caretDownIcon, Icon, type PhIcon } from './icons';
import { Listbox } from './Listbox';
import { useCoarsePointer } from './pointer';

// ── buttons ─────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'suite';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  /** `primary` is the app's colour; `suite` is the accent colour, for the suite's own chrome. */
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: PhIcon;
  /** A trailing chevron, for a button that opens a menu. */
  chevron?: boolean;
  fullWidth?: boolean;
  className?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, chevron, fullWidth, className, children, type = 'button', style, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      data-variant={variant}
      data-size={size}
      className={className ? `oa-btn ${className}` : 'oa-btn'}
      style={fullWidth ? { width: '100%', ...style } : style}
      {...rest}
    >
      {icon && <Icon icon={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
      {chevron && <Icon icon={caretDownIcon} size={12} className="oa-btn-chevron" />}
    </button>
  );
});

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> {
  icon: PhIcon;
  /** The accessible name, and the hover title. */
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
  iconSize?: number;
  className?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', active, iconSize, className, type = 'button', title, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      data-size={size}
      {...(active === undefined ? {} : { 'aria-pressed': active })}
      className={className ? `oa-ib ${className}` : 'oa-ib'}
      {...rest}
    >
      <Icon icon={icon} size={iconSize ?? (size === 'sm' ? 14 : 16)} />
    </button>
  );
});

// ── fields ──────────────────────────────────────────────────────────────────

type FieldBase = {
  label?: string;
  hint?: string;
  error?: string;
  /** A leading icon. */
  icon?: PhIcon;
  /** Something at the right edge, inside the field: a show-password button, a role menu. */
  trailing?: React.ReactNode;
  size?: 'sm' | 'md';
};

export type TextFieldProps = FieldBase &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'className'> & {
    multiline?: false;
    inputRef?: React.Ref<HTMLInputElement>;
  };

export type TextAreaProps = FieldBase &
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
    multiline: true;
    rows?: number;
    inputRef?: React.Ref<HTMLTextAreaElement>;
  };

let fieldSeq = 0;

/** A field on the sunken tone. A label, a hint and an error are each optional, and
 *  an error replaces the hint. */
export function TextField(props: TextFieldProps | TextAreaProps) {
  const { label, hint, error, icon, trailing, size = 'md', multiline, inputRef, ...rest } = props;
  const [id] = useState(() => (props.id as string | undefined) ?? `oa-f${++fieldSeq}`);
  const note = error ?? hint;
  const describedBy = note ? `${id}-note` : undefined;

  return (
    <div className="oa-field" data-size={size} data-invalid={error ? 'true' : undefined}>
      {label && (
        <label htmlFor={id} className="oa-field-label">
          {label}
        </label>
      )}
      <div className="oa-field-box" data-multiline={multiline ? 'true' : undefined}>
        {icon && <Icon icon={icon} size={16} className="oa-field-icon" />}
        {multiline ? (
          <textarea
            id={id}
            ref={inputRef as React.Ref<HTMLTextAreaElement>}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            rows={(props as TextAreaProps).rows ?? 3}
            {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          />
        ) : (
          <input
            id={id}
            ref={inputRef as React.Ref<HTMLInputElement>}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            {...(rest as React.InputHTMLAttributes<HTMLInputElement>)}
          />
        )}
        {trailing}
      </div>
      {note && (
        <div id={`${id}-note`} className="oa-field-note" data-tone={error ? 'danger' : undefined}>
          {note}
        </div>
      )}
    </div>
  );
}

// ── select ──────────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
  /** Shown, never pointed at and never chosen. */
  disabled?: boolean;
}

/**
 * The boards' dropdown button. On a mouse and a keyboard it opens the page's own listbox
 * (Listbox.tsx), which a dialog cannot clip and the browser cannot draw wrongly; where the main
 * pointer is a finger it is the platform's select, whose sheet a phone draws better than a page can.
 * `value` and `onChange` mean what they always meant either way.
 */
export function Select({
  value,
  options,
  onChange,
  label,
  size = 'md',
  quiet,
  disabled,
  style,
  ...rest
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  label?: string;
  size?: 'sm' | 'md';
  /** No border until hovered: the role menu inside the add-people field. */
  quiet?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value' | 'size' | 'style' | 'disabled'>) {
  const [id] = useState(() => (rest.id as string | undefined) ?? `oa-s${++fieldSeq}`);
  const coarse = useCoarsePointer();
  const { id: _id, ...others } = rest;
  return (
    <div className="oa-field" data-size={size} style={style}>
      {label && (
        <label htmlFor={id} className="oa-field-label">
          {label}
        </label>
      )}
      <div className="oa-select" data-quiet={quiet ? 'true' : undefined} data-disabled={disabled ? 'true' : undefined}>
        {coarse ? (
          <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} {...rest}>
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <Listbox
            {...(others as unknown as React.ButtonHTMLAttributes<HTMLButtonElement>)}
            id={id}
            value={value}
            options={options}
            onChange={onChange}
            disabled={disabled}
            name={(rest['aria-label'] as string | undefined) ?? label}
          />
        )}
        <Icon icon={caretDownIcon} size={12} className="oa-select-chevron" />
      </div>
    </div>
  );
}

// ── switch ──────────────────────────────────────────────────────────────────

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  ...rest
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The accessible name. Draw the visible label yourself, beside it. */
  label: string;
  disabled?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'aria-checked' | 'aria-label'>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="oa-switch"
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span className="oa-switch-thumb" />
    </button>
  );
}

// ── chips and groups ────────────────────────────────────────────────────────

/** A pill that is on or off: Home's kind filter. */
export function Chip({
  pressed,
  onClick,
  children
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="oa-chip" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

/** A small group of icon buttons, one pressed: the grid and list switch. */
export function Segmented<T extends string>({
  value,
  onChange,
  items,
  label
}: {
  value: T;
  onChange: (next: T) => void;
  items: readonly { value: T; label: string; icon: PhIcon }[];
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="oa-seg">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          aria-label={it.label}
          title={it.label}
          aria-pressed={value === it.value}
          onClick={() => onChange(it.value)}
        >
          <Icon icon={it.icon} size={16} />
        </button>
      ))}
    </div>
  );
}

// ── the sliding indicator ───────────────────────────────────────────────────

/**
 * An underline, or a rail's selection, that slides to the active item rather than
 * jumping. The container is `position: relative` and each item carries
 * `data-key`; the active one is measured and its offset and size are written to
 * the container as `--ind-x`/`--ind-w` (or `--ind-y`/`--ind-h`). The indicator
 * element is a 1px box moved and scaled with a transform, so nothing animates
 * layout.
 *
 * The first measure has no transition (`data-ready` is set a frame later), or the
 * underline would slide in from the left edge on every page load.
 */
export function useIndicator<T extends HTMLElement>(active: string | null, axis: 'x' | 'y' = 'x', deps: unknown[] = []) {
  const ref = useRef<T | null>(null);

  const measure = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const item = active
      ? ([...root.querySelectorAll<HTMLElement>('[data-key]')].find((n) => n.dataset.key === active) ?? null)
      : null;
    if (!item) {
      root.style.setProperty('--ind-o', '0');
      return;
    }
    root.style.setProperty('--ind-o', '1');
    if (axis === 'x') {
      root.style.setProperty('--ind-x', `${item.offsetLeft}px`);
      root.style.setProperty('--ind-w', String(item.offsetWidth));
    } else {
      root.style.setProperty('--ind-y', `${item.offsetTop}px`);
      root.style.setProperty('--ind-h', String(item.offsetHeight));
    }
  }, [active, axis]);

  useLayoutEffect(() => {
    measure();
    const root = ref.current;
    if (!root) return;
    const id = requestAnimationFrame(() => root.setAttribute('data-ready', 'true'));
    // Webfonts arriving, or the window resizing, move the items.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    return () => {
      cancelAnimationFrame(id);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return ref;
}

/** Underline tabs with the sliding indicator: "Suggested, Yours, <organisation>". */
export function UnderlineTabs({
  items,
  value,
  onChange,
  label
}: {
  items: readonly { value: string; label: string; icon?: PhIcon }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const ref = useIndicator<HTMLDivElement>(value, 'x', [items.length]);
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const at = items.findIndex((i) => i.value === value);
    const next = items[(at + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length];
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(next.value)}"]`)?.focus()
    );
  };
  return (
    <div ref={ref} role="tablist" aria-label={label} className="oa-utabs" onKeyDown={move}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          data-key={it.value}
          aria-selected={it.value === value}
          tabIndex={it.value === value ? 0 : -1}
          onClick={() => onChange(it.value)}
        >
          {it.icon && <Icon icon={it.icon} size={14} />}
          {it.label}
        </button>
      ))}
      <span className="oa-ind oa-ind-x" aria-hidden="true" />
    </div>
  );
}
