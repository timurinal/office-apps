// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SheetModel, buildSheetSeed, localSheetSource } from './model';
import { estimateMeasure } from './model/measure';
import { sameSheets, shallowEqual, useModelSlice, useSaving, useSheetModel } from './useSheetModel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const seed = buildSheetSeed((b) => {
  b.addSheet('One');
  b.addSheet('Two');
});

async function model(): Promise<SheetModel> {
  const m = new SheetModel(localSheetSource({ state: seed.state, cells: seed.cells }), { measure: estimateMeasure() });
  await Promise.resolve();
  await Promise.resolve();
  return m;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('a slice of the model', () => {
  it('re-renders for a change to what it reads, and for nothing else', async () => {
    const m = await model();
    const renders = vi.fn();
    function Probe() {
      const sheets = useModelSlice(m, (x) => x.sheets(), sameSheets);
      renders(sheets?.map((s) => s.name).join(','));
      return null;
    }
    act(() => root.render(<Probe />));
    expect(renders).toHaveBeenLastCalledWith('One,Two');
    const before = renders.mock.calls.length;

    // An edit and a selection bump the model and change no sheet.
    const sheet = m.sheets()[0]!.id;
    act(() => {
      m.input(sheet, { row: 0, col: 0 }, '5');
      m.input(sheet, { row: 1, col: 0 }, '6');
    });
    expect(renders.mock.calls.length).toBe(before);

    // A rename does.
    act(() => m.renameSheet(sheet, 'Costs'));
    expect(renders).toHaveBeenLastCalledWith('Costs,Two');
    expect(renders.mock.calls.length).toBe(before + 1);
  });

  it('is null until there is a model', () => {
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useModelSlice(null, () => 1));
      return null;
    }
    act(() => root.render(<Probe />));
    expect(seen).toEqual([null]);
  });

  it('compares sheets and shallow records by value', () => {
    const a = { id: 'a', name: 'A', color: null, hidden: false };
    expect(sameSheets([a], [{ ...a }])).toBe(true);
    expect(sameSheets([a], [{ ...a, color: '#fff' }])).toBe(false);
    expect(sameSheets([a], [])).toBe(false);
    expect(shallowEqual({ x: 1, y: null }, { x: 1, y: null })).toBe(true);
    expect(shallowEqual({ x: 1 }, { x: 2 })).toBe(false);
  });
});

describe('saving', () => {
  it('says Saving only when a step has waited, never for an answer that comes at once', async () => {
    vi.useFakeTimers();
    const m = new SheetModel(localSheetSource({ state: seed.state, cells: seed.cells }), { measure: estimateMeasure() });
    await vi.advanceTimersByTimeAsync(0);
    const sheet = m.sheets()[0]!.id;
    const labels: boolean[] = [];
    function Probe() {
      labels.push(useSaving(m, 500));
      return null;
    }
    act(() => root.render(<Probe />));

    // A local source acknowledges in a microtask: a step is saved before the timer is up.
    await act(async () => {
      m.input(sheet, { row: 0, col: 0 }, '1');
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(labels.every((x) => x === false)).toBe(true);
  });

  it('says it once the steps have waited past the limit, and stops when they are acknowledged', async () => {
    vi.useFakeTimers();
    let pending = true;
    // A model whose steps stay unacknowledged until told: the status says what it says.
    const fake = {
      status: () => ({ pending: pending ? 1 : 0 }),
      subscribe: (cb: () => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      }
    } as unknown as SheetModel;
    const listeners = new Set<() => void>();
    let latest = false;
    function Probe() {
      latest = useSaving(fake, 500);
      return null;
    }
    act(() => root.render(<Probe />));
    expect(latest).toBe(false);
    act(() => void vi.advanceTimersByTime(400));
    expect(latest).toBe(false);
    act(() => void vi.advanceTimersByTime(200));
    expect(latest).toBe(true);
    pending = false;
    act(() => listeners.forEach((l) => l()));
    expect(latest).toBe(false);
  });
});

describe('making a model', () => {
  it('makes one on a source, makes it read only for a reader, and lets go of it', async () => {
    const source = localSheetSource({ state: seed.state, cells: seed.cells });
    const hooks = { readOnly: true, user: { name: 'Ada', color: '#123456' }, onRoleChanged: () => undefined, checkAccess: async () => 'ok' as const };
    let got: SheetModel | null = null;
    function Probe({ readOnly }: { readOnly: boolean }) {
      got = useSheetModel(source, { ...hooks, readOnly });
      return null;
    }
    act(() => root.render(<Probe readOnly={true} />));
    expect(got).not.toBeNull();
    expect(got!.isReadOnly()).toBe(true);
    act(() => root.render(<Probe readOnly={false} />));
    expect(got!.isReadOnly()).toBe(false);
    const made = got! as SheetModel;
    const destroy = vi.spyOn(made, 'destroy');
    act(() => root.render(<div />));
    expect(destroy).toHaveBeenCalled();
  });
});
