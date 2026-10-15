import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRetryMs, SaveQueue, type SaveState } from './savequeue';

class Stale extends Error {}

function setup(over: { put?: (rev: number, p: string) => Promise<{ rev: number }>; rev?: number } = {}) {
  let content = 'v1';
  const states: SaveState[] = [];
  const puts: { rev: number; payload: string }[] = [];
  const queue = new SaveQueue<string>({
    rev: over.rev ?? 1,
    delayMs: 1000,
    produce: async () => content,
    put:
      over.put ??
      (async (rev, payload) => {
        puts.push({ rev, payload });
        return { rev: rev + 1 };
      }),
    isStale: (e) => e instanceof Stale,
    onState: (s) => states.push(s)
  });
  return { queue, puts, states, edit: (c: string) => ((content = c), queue.touch()) };
}

describe('SaveQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves once after a burst of edits, carrying the last content', async () => {
    const { queue, puts, edit } = setup();
    edit('a');
    await vi.advanceTimersByTimeAsync(400);
    edit('ab');
    await vi.advanceTimersByTimeAsync(400);
    edit('abc');
    expect(puts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(puts).toEqual([{ rev: 1, payload: 'abc' }]);
    expect(queue.state).toBe('saved');
  });

  it('quotes the revision the last save returned', async () => {
    const { puts, edit } = setup({ rev: 7 });
    edit('a');
    await vi.advanceTimersByTimeAsync(1000);
    edit('b');
    await vi.advanceTimersByTimeAsync(1000);
    expect(puts.map((p) => p.rev)).toEqual([7, 8]);
  });

  it('builds each payload for the revision that save will quote', async () => {
    const built: number[] = [];
    const quoted: number[] = [];
    const queue = new SaveQueue<string>({
      rev: 7,
      delayMs: 1000,
      produce: async (rev) => (built.push(rev), 'x'),
      put: async (rev) => (quoted.push(rev), { rev: rev + 1 }),
      isStale: () => false,
      onState: () => {}
    });
    queue.touch();
    await vi.advanceTimersByTimeAsync(1000);
    queue.touch();
    await vi.advanceTimersByTimeAsync(1000);
    expect(built).toEqual([7, 8]);
    expect(quoted).toEqual(built);
  });

  it('saves an edit made during a save straight after it, never alongside it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const seen: number[] = [];
    let inFlight = 0;
    let overlapped = false;
    const { queue, edit } = setup({
      put: async (rev) => {
        inFlight++;
        if (inFlight > 1) overlapped = true;
        seen.push(rev);
        if (rev === 1) await gate;
        inFlight--;
        return { rev: rev + 1 };
      }
    });
    edit('a');
    await vi.advanceTimersByTimeAsync(1000);
    expect(queue.state).toBe('saving');
    edit('ab');
    release();
    await vi.advanceTimersByTimeAsync(0);
    await queue.flush();
    expect(seen).toEqual([1, 2]);
    expect(overlapped).toBe(false);
    expect(queue.state).toBe('saved');
  });

  it('stops for good on a stale revision', async () => {
    let calls = 0;
    const { queue, states, edit } = setup({
      put: async () => {
        calls++;
        throw new Stale('412');
      }
    });
    edit('a');
    await vi.advanceTimersByTimeAsync(1000);
    expect(queue.state).toBe('conflict');
    edit('ab');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(1);
    expect(states[states.length - 1]).toBe('conflict');
  });

  it('retries after a failure with a growing wait, and ends saved', async () => {
    let calls = 0;
    const { queue, edit } = setup({
      put: async (rev) => {
        calls++;
        if (calls < 3) throw new Error('offline');
        return { rev: rev + 1 };
      }
    });
    edit('a');
    await vi.advanceTimersByTimeAsync(1000);
    expect(queue.state).toBe('error');
    await vi.advanceTimersByTimeAsync(defaultRetryMs(1));
    expect(queue.state).toBe('error');
    await vi.advanceTimersByTimeAsync(defaultRetryMs(2));
    expect(calls).toBe(3);
    expect(queue.state).toBe('saved');
  });

  it('does not postpone a retry that is already coming when the person keeps typing', async () => {
    let calls = 0;
    const { queue, edit } = setup({
      put: async (rev) => {
        calls++;
        if (calls === 1) throw new Error('offline');
        return { rev: rev + 1 };
      }
    });
    edit('a');
    await vi.advanceTimersByTimeAsync(1000);
    expect(queue.state).toBe('error');
    await vi.advanceTimersByTimeAsync(1500);
    edit('ab');
    await vi.advanceTimersByTimeAsync(600);
    expect(calls).toBe(2);
    expect(queue.state).toBe('saved');
  });

  it('flush saves now', async () => {
    const { queue, puts, edit } = setup();
    edit('a');
    expect(await queue.flush()).toBe('saved');
    expect(puts).toHaveLength(1);
  });

  it('flush with nothing to save sends nothing', async () => {
    const { queue, puts } = setup();
    expect(await queue.flush()).toBe('saved');
    expect(puts).toHaveLength(0);
  });

  it('sends nothing after it is disposed', async () => {
    const { queue, puts, edit } = setup();
    edit('a');
    queue.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    edit('b');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(puts).toHaveLength(0);
  });
});

describe('defaultRetryMs', () => {
  it('doubles from two seconds and stops at thirty', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(defaultRetryMs)).toEqual([2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
  });
});
