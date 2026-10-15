/**
 * The pane's small controls, drawn as the board draws them: a label at the left and a field 112 px
 * wide at the right, the number in the mono face with its unit, collapsible sections with a chevron.
 *
 * A number field shows the value in its unit and takes what is typed in any unit it understands
 * (`units.ts`). It commits when Enter is pressed or the field is left, puts the old value back on
 * Escape, and steps with the arrow keys (Shift for ten times as much), each step a commit: a step for
 * every keystroke of "8.76" would be four undo entries. A value that differs across the selection
 * is blank.
 */

import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { caretDownIcon, caretRightIcon, caretUpIcon, Icon } from '../../../core/icons';
import { Select, type SelectOption } from '../../../core/controls';

export function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="sl-fp-section">
      <button type="button" className="sl-fp-sec" aria-expanded={open} onClick={onToggle}>
        <Icon icon={open ? caretDownIcon : caretRightIcon} size={11} />
        {title}
      </button>
      {open && <div className="sl-fp-body">{children}</div>}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sl-fp-row">
      <span className="sl-fp-label">{label}</span>
      {children}
    </div>
  );
}

/** A label above a control that needs the pane's whole width: a choice of three words, a long dropdown. */
export function Stack({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sl-fp-stack">
      <span className="sl-fp-label">{label}</span>
      {children}
    </div>
  );
}

export interface NumFieldProps {
  label: string;
  /** In stored units, or null for a selection whose values differ. */
  value: number | null;
  format: (n: number) => string;
  parse: (text: string) => number | null;
  /** One arrow press, in stored units. */
  step: number;
  min?: number;
  max?: number;
  onCommit: (n: number) => void;
  disabled?: boolean;
}

export function NumField({ label, value, format, parse, step, min = -Infinity, max = Infinity, onCommit, disabled }: NumFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number): number => Math.min(max, Math.max(min, n));

  const commit = () => {
    if (draft === null) return;
    const n = parse(draft);
    setDraft(null);
    if (n === null) return;
    const next = clamp(n);
    if (value === null || Math.abs(next - value) > 1e-9) onCommit(next);
  };

  const bump = (dir: 1 | -1, big: boolean) => {
    const base = draft !== null ? (parse(draft) ?? value ?? 0) : (value ?? 0);
    setDraft(null);
    onCommit(clamp(base + dir * step * (big ? 10 : 1)));
  };

  return (
    <span className="sl-fp-fld" data-disabled={disabled ? '' : undefined}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        disabled={disabled}
        value={draft ?? (value === null ? '' : format(value))}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape' && draft !== null) {
            e.preventDefault();
            e.stopPropagation();
            setDraft(null);
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            bump(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
          }
        }}
      />
      <span className="sl-fp-spin" aria-hidden="true">
        <button type="button" tabIndex={-1} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => bump(1, false)}>
          <Icon icon={caretUpIcon} size={9} />
        </button>
        <button type="button" tabIndex={-1} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => bump(-1, false)}>
          <Icon icon={caretDownIcon} size={9} />
        </button>
      </span>
    </span>
  );
}

/** A tick box and its words. `null` is a selection that differs: drawn as neither on nor off. */
export function Check({ label, value, onChange, disabled }: { label: string; value: boolean | null; onChange: (on: boolean) => void; disabled?: boolean }) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = value === null;
  }, [value]);
  return (
    <label className="sl-fp-check" data-disabled={disabled ? '' : undefined}>
      <input ref={box} type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** A choice of a few, as buttons in a row; none is pressed when the selection differs. */
export function Seg<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T | null; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="sl-fp-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} disabled={disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A native dropdown in the field's place. A selection that differs shows a blank first row. */
export function Dropdown({ label, value, options, onChange, disabled }: { label: string; value: string | null; options: readonly SelectOption[]; onChange: (v: string) => void; disabled?: boolean }) {
  const all = value === null ? [{ value: '', label: '' }, ...options] : options;
  return (
    <span className="sl-fp-pick">
      <Select aria-label={label} size="sm" value={value ?? ''} options={all} disabled={disabled} onChange={(v) => v && onChange(v)} />
    </span>
  );
}

/** A text field that commits when it is left (Escape puts the old text back): the alt text, a chart's title. */
export function CommitText({ label, value, onCommit, multiline, placeholder, disabled }: { label: string; value: string | null; onCommit: (text: string) => void; multiline?: boolean; placeholder?: string; disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value ?? '';
  const done = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft !== (value ?? '')) onCommit(draft);
  };
  const common = {
    'aria-label': label,
    value: shown,
    placeholder: placeholder ?? (value === null ? 'Mixed' : undefined),
    disabled,
    spellCheck: true,
    onBlur: done
  };
  return multiline ? (
    <textarea
      className="sl-fp-text"
      rows={3}
      {...common}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && draft !== null) {
          e.preventDefault();
          e.stopPropagation();
          setDraft(null);
        }
      }}
    />
  ) : (
    <input
      type="text"
      className="sl-fp-text"
      {...common}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          done();
        } else if (e.key === 'Escape' && draft !== null) {
          e.preventDefault();
          e.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}
