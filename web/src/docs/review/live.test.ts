import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { linkRoom } from './live';
import type { ReviewStore } from './store';

/** Two people's awareness, joined as the room joins them, with a switch to cut the line. */
function room() {
  const a = new Awareness(new Y.Doc());
  const b = new Awareness(new Y.Doc());
  let connected = true;
  let losing = 0;
  const pipe = (from: Awareness, to: Awareness) =>
    from.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      if (from === b && losing > 0) return void losing--;
      if (connected) applyAwarenessUpdate(to, encodeAwarenessUpdate(from, [...added, ...updated, ...removed]), 'remote');
    });
  pipe(a, b);
  pipe(b, a);
  a.setLocalState({ user: 'ada' });
  b.setLocalState({ user: 'ben' });
  return {
    a,
    b,
    /** The room drops Ben's next frame, as it does past his socket's budget. */
    loseNext: () => void losing++,
    /** Ben's socket drops: Ada forgets him, as y-websocket does on a close. */
    drop: () => {
      connected = false;
      removeAwarenessStates(a, [b.clientID], 'closed');
    },
    /** And comes back: his whole state is sent again. */
    rejoin: () => {
      connected = true;
      applyAwarenessUpdate(a, encodeAwarenessUpdate(b, [b.clientID]), 'remote');
    },
    destroy: () => (a.destroy(), b.destroy())
  };
}

const fakeStore = () => ({ load: vi.fn(async () => undefined), onSaved: null }) as unknown as ReviewStore & { load: ReturnType<typeof vi.fn> };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the room nudge', () => {
  it('makes the others look again when one person saves, once for a burst', () => {
    const r = room();
    const ada = fakeStore();
    const ben = fakeStore();
    linkRoom(ada, r.a);
    linkRoom(ben, r.b);

    ben.onSaved!();
    ben.onSaved!();
    vi.advanceTimersByTime(200);
    expect(ada.load).toHaveBeenCalledTimes(1);
    expect(ben.load).not.toHaveBeenCalled();
    // Said again a moment later, which is no news to Ada.
    vi.advanceTimersByTime(2000);
    expect(ada.load).toHaveBeenCalledTimes(1);
    r.destroy();
  });

  it('says it again when the room drops the frame that carried it', () => {
    const r = room();
    const ada = fakeStore();
    const ben = fakeStore();
    linkRoom(ada, r.a);
    linkRoom(ben, r.b);

    r.loseNext();
    ben.onSaved!();
    vi.advanceTimersByTime(200);
    expect(ada.load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(ada.load).toHaveBeenCalledTimes(1);
    r.destroy();
  });

  it('does not look again for a caret moving', () => {
    const r = room();
    const ada = fakeStore();
    linkRoom(ada, r.a);
    r.b.setLocalStateField('cursor', { at: 4 });
    vi.advanceTimersByTime(200);
    expect(ada.load).not.toHaveBeenCalled();
    r.destroy();
  });

  it('hears a save made while the line was down, when it comes back', () => {
    const r = room();
    const ada = fakeStore();
    const ben = fakeStore();
    linkRoom(ada, r.a);
    linkRoom(ben, r.b);
    ben.onSaved!();
    vi.advanceTimersByTime(200);
    expect(ada.load).toHaveBeenCalledTimes(1);

    r.drop();
    ben.onSaved!();
    r.rejoin();
    vi.advanceTimersByTime(200);
    expect(ada.load).toHaveBeenCalledTimes(2);
    r.destroy();
  });

  it('never sends a number twice when the link is made again', () => {
    const r = room();
    const ada = fakeStore();
    const ben = fakeStore();
    linkRoom(ada, r.a);
    const first = linkRoom(ben, r.b);
    ben.onSaved!();
    vi.advanceTimersByTime(200);
    first();
    linkRoom(ben, r.b);
    ben.onSaved!();
    vi.advanceTimersByTime(200);
    expect(ada.load).toHaveBeenCalledTimes(2);
    r.destroy();
  });

  it('leaves a newer link’s hook alone when an older one is undone', () => {
    const r = room();
    const store = fakeStore();
    const older = linkRoom(store, r.a);
    linkRoom(store, r.a);
    const hook = store.onSaved;
    older();
    expect(store.onSaved).toBe(hook);
    r.destroy();
  });
});
