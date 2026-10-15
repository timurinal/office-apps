import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostError, type Host, type SaveResult, type WindowState } from './host';
import { Session } from './session';

function fakeHost(over: Partial<Host> = {}) {
  const states: WindowState[] = [];
  const saves: { bytes: Uint8Array; force?: boolean }[] = [];
  const host = {
    setState: (s: WindowState) => states.push(s),
    save: vi.fn(async (bytes: Uint8Array, opts?: { force?: boolean }): Promise<SaveResult> => {
      saves.push({ bytes, force: opts?.force });
      return { path: '/d/Note.oadoc', name: 'Note.oadoc', mtime: 1 };
    }),
    saveAs: vi.fn(async (_b: Uint8Array, name: string): Promise<SaveResult | null> => ({ path: `/d/${name}`, name, mtime: 1 })),
    rename: vi.fn(async (name: string): Promise<SaveResult> => ({ path: `/d/${name}.oadoc`, name: `${name}.oadoc`, mtime: 2 })),
    ...over
  } as unknown as Host;
  return { host, states, saves };
}

describe('a document session', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not count what happens before it is armed', () => {
    const { host } = fakeHost();
    const s = new Session({ host, kind: 'docs', id: 'a', title: 'Untitled document', path: null });
    s.touch();
    expect(s.dirty).toBe(false);
    s.arm();
    s.touch();
    expect(s.dirty).toBe(true);
    expect(s.state).toBe('edited');
  });

  it('asks where on the first save, and takes the file name as the title', async () => {
    const { host, states } = fakeHost();
    const s = new Session({ host, kind: 'docs', id: 'a', title: 'Untitled document', path: null });
    s.serialize = () => new Uint8Array([7]);
    s.arm();
    s.touch();
    expect(await s.save()).toBe(true);
    expect(host.saveAs).toHaveBeenCalledWith(new Uint8Array([7]), 'Untitled document.oadoc');
    expect(s.path).toBe('/d/Untitled document.oadoc');
    expect(s.title).toBe('Untitled document');
    expect(s.dirty).toBe(false);
    expect(states.at(-1)).toEqual({ title: 'Untitled document', dirty: false, hasPath: true, saving: false });
  });

  it('does nothing when the save panel is cancelled', async () => {
    const { host } = fakeHost({ saveAs: vi.fn(async () => null) } as Partial<Host>);
    const s = new Session({ host, kind: 'sheets', id: 'a', title: 'Book', path: null });
    s.serialize = () => new Uint8Array();
    s.arm();
    s.touch();
    expect(await s.save()).toBe(false);
    expect(s.path).toBeNull();
    expect(s.dirty).toBe(true);
  });

  it('saves a file by itself, once, after the edits stop', async () => {
    const { host, saves } = fakeHost();
    const s = new Session({ host, kind: 'docs', id: 'a', title: 'Note', path: '/d/Note.oadoc', delayMs: 1000 });
    let n = 0;
    s.serialize = () => new Uint8Array([++n]);
    s.arm();
    s.touch();
    s.touch();
    await vi.advanceTimersByTimeAsync(500);
    s.touch();
    expect(saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves).toHaveLength(1);
    expect(s.dirty).toBe(false);
    expect(s.state).toBe('saved');
  });

  it('stops on a file changed elsewhere, and writes over it only when told', async () => {
    const save = vi.fn(async (_b: Uint8Array, opts?: { force?: boolean }) => {
      if (!opts?.force) throw new HostError('stale', 'This file was changed by another app.');
      return { path: '/d/Note.oadoc', name: 'Note.oadoc', mtime: 3 };
    });
    const { host } = fakeHost({ save } as Partial<Host>);
    const s = new Session({ host, kind: 'docs', id: 'a', title: 'Note', path: '/d/Note.oadoc' });
    s.serialize = () => new Uint8Array([1]);
    s.arm();
    s.touch();
    expect(await s.flush()).toBe(false);
    expect(s.state).toBe('conflict');
    expect(await s.save()).toBe(false);
    expect(await s.overwrite()).toBe(true);
    expect(save).toHaveBeenLastCalledWith(new Uint8Array([1]), { force: true });
    expect(s.state).toBe('saved');
  });

  it('renames the file, or only the title when there is none', async () => {
    const { host } = fakeHost();
    const fresh = new Session({ host, kind: 'docs', id: 'a', title: 'Untitled document', path: null });
    expect(await fresh.rename('Plans')).toBe('Plans');
    expect(host.rename).not.toHaveBeenCalled();
    const filed = new Session({ host, kind: 'docs', id: 'a', title: 'Note', path: '/d/Note.oadoc' });
    expect(await filed.rename('Plans')).toBe('Plans');
    expect(filed.path).toBe('/d/Plans.oadoc');
  });
});
