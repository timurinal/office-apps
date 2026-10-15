// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyFor, matches, parseKey, useSheetsKeys } from './keys';
import type { SheetsContext, SheetsKey } from './modules/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ev = (init: Partial<KeyboardEvent> & { key: string }) =>
  ({ code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init }) as KeyboardEvent;

describe('matching a key', () => {
  it('reads Mod as Ctrl or Cmd and keeps undo and redo apart by Shift', () => {
    expect(parseKey('Mod+Shift+Z')).toEqual({ mod: true, shift: true, alt: false, key: 'z' });
    expect(matches('Mod+Z', ev({ key: 'z', ctrlKey: true }))).toBe(true);
    expect(matches('Mod+Z', ev({ key: 'Z', metaKey: true }))).toBe(true);
    expect(matches('Mod+Z', ev({ key: 'Z', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matches('Mod+Shift+Z', ev({ key: 'Z', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matches('Mod+Y', ev({ key: 'y', ctrlKey: true }))).toBe(true);
    expect(matches('Mod+Z', ev({ key: 'z' }))).toBe(false);
    expect(matches('Mod+Z', ev({ key: 'z', ctrlKey: true, altKey: true }))).toBe(false);
  });

  it('takes the slash for the command box', () => {
    expect(matches('Mod+/', ev({ key: '/', ctrlKey: true }))).toBe(true);
    expect(matches('Mod+/', ev({ key: '?', ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it('takes Ctrl+- for delete, and the plus key however the keyboard makes it for insert', () => {
    expect(matches('Mod+-', ev({ key: '-', ctrlKey: true }))).toBe(true);
    expect(matches('Mod+-', ev({ key: '-', code: 'NumpadSubtract', ctrlKey: true }))).toBe(true);
    expect(matches('Mod+-', ev({ key: '_', ctrlKey: true, shiftKey: true }))).toBe(false);

    expect(parseKey('Mod++').key).toBe('+');
    // Shift and = on a US keyboard, a + key on others, and the numpad's.
    expect(matches('Mod++', ev({ key: '+', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matches('Mod++', ev({ key: '=', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matches('Mod++', ev({ key: '+', code: 'NumpadAdd', ctrlKey: true }))).toBe(true);
    // Plain Ctrl+= is the browser's zoom, and is never taken.
    expect(matches('Mod++', ev({ key: '=', ctrlKey: true }))).toBe(false);
  });

  it('skips a key whose `when` says no', () => {
    const ctx = { can: { edit: false } } as SheetsContext;
    const keys: SheetsKey[] = [{ keys: 'Mod+Z', when: (c) => c.can.edit, run: () => undefined }];
    expect(keyFor(keys, ev({ key: 'z', ctrlKey: true }), ctx)).toBeUndefined();
    expect(keyFor(keys, ev({ key: 'z', ctrlKey: true }), { can: { edit: true } } as SheetsContext)).toBe(keys[0]);
  });
});

describe('the listener', () => {
  let host: HTMLDivElement | null = null;
  afterEach(() => {
    host?.remove();
    host = null;
  });

  function mount(keys: SheetsKey[], ctx: SheetsContext | null = {} as SheetsContext) {
    host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    function Probe() {
      useSheetsKeys(keys, ctx);
      return (
        <div>
          <div id="grid" tabIndex={0} />
          <input id="field" />
          <div role="dialog">
            <button id="inside" />
          </div>
        </div>
      );
    }
    act(() => root.render(<Probe />));
    return () => act(() => root.unmount());
  }

  const press = (el: Element, init: KeyboardEventInit) => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(e);
    return e;
  };

  it('runs the key from the grid and prevents the browser, unless it says it did nothing', () => {
    const used = vi.fn();
    const skipped = vi.fn(() => false);
    const off = mount([
      { keys: 'Mod+Z', run: used },
      { keys: 'Mod+-', run: skipped }
    ]);
    const grid = document.getElementById('grid')!;
    expect(press(grid, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(used).toHaveBeenCalledTimes(1);
    expect(press(grid, { key: '-', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(skipped).toHaveBeenCalledTimes(1);
    off();
  });

  it('leaves a field, a dialog and a key the grid has taken alone', () => {
    const run = vi.fn();
    const off = mount([{ keys: 'Mod+Z', run }]);
    press(document.getElementById('field')!, { key: 'z', ctrlKey: true });
    press(document.getElementById('inside')!, { key: 'z', ctrlKey: true });
    const taken = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    document.getElementById('grid')!.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
    document.getElementById('grid')!.dispatchEvent(taken);
    expect(run).not.toHaveBeenCalled();
    off();
  });

  it('does nothing before the workbook has a context', () => {
    const run = vi.fn();
    const off = mount([{ keys: 'Mod+Z', run }], null);
    expect(press(document.getElementById('grid')!, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
    off();
  });
});
