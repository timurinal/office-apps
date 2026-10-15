/** Small pieces the tools' dialogs share, so each dialog is its fields and nothing else. */

import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../core/controls';
import { useModalClose } from '../../core/ui';
import type { SheetModel } from '../model';
import type { SheetsContext } from '../modules/types';
import './tools.css';

/** A tick box with its label: the native one, so the keyboard and a screen reader have it whole. */
export function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="sx-check" data-disabled={disabled ? 'true' : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** A label above whatever it labels, for a field that is not a `TextField`. */
export function Labelled({ label, children, grow }: { label: string; children: ReactNode; grow?: boolean }) {
  return (
    <div className="sx-labelled" style={grow ? { flex: 1, minWidth: 0 } : undefined}>
      <span className="sx-labelled-text">{label}</span>
      {children}
    </div>
  );
}

/** The browser's colour input, with its name. */
export function ColorInput({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  return <input type="color" className="sx-color" aria-label={label} title={label} value={value} onChange={(e) => onChange(e.target.value)} />;
}

/** The model's version, so a view of what it holds follows a change made from anywhere (a person on another screen too). */
export function useModelVersion(model: SheetModel): number {
  return useSyncExternalStore(
    (cb) => model.subscribe(cb),
    () => model.version,
    () => 0
  );
}

/** A row of fields that share the width. */
export function Fields({ children }: { children: ReactNode }) {
  return <div className="sx-fields">{children}</div>;
}

/** The dialog's footer: what it can do, at the right; `start` is something at the left, such as Clear all. */
export function Actions({ start, children }: { start?: ReactNode; children: ReactNode }) {
  return (
    <>
      {start}
      <span style={{ flex: 1 }} />
      {children}
    </>
  );
}

/**
 * Cancel and the one thing the dialog does. It lives inside the dialog, so it can close it with
 * the exit animation; `onApply` returns false to keep the dialog open (something to fix first).
 * Pressing Enter in a field presses it, through the form the body is in.
 */
export function Footer({
  form,
  apply,
  onApply,
  disabled,
  start
}: {
  form: string;
  apply: string;
  onApply: () => boolean | void;
  disabled?: boolean;
  start?: ReactNode;
}) {
  const close = useModalClose();
  return (
    <Actions start={start}>
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
      <Button
        variant="primary"
        type="submit"
        form={form}
        disabled={disabled}
        onClick={() => {
          if (onApply() !== false) close();
        }}
      >
        {apply}
      </Button>
    </Actions>
  );
}

/** What a tool's dialog is given. */
export interface ToolProps {
  ctx: SheetsContext;
  /**
   * Called when the dialog has gone, whatever closed it. `after` runs once it is really gone, which
   * is when something that wants the keyboard can have it: a dialog that closes returns the focus
   * to where it was, and would take it back from whatever was given it sooner.
   */
  onClose: (after?: () => void) => void;
}
