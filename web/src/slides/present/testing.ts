/**
 * What the slide show's tests share. Not shipped: nothing but a test imports it.
 */

import type { ChannelFactory, ChannelLike } from './protocol';

/**
 * A stand-in for the browser's channels: channels of one name reach each other and not themselves,
 * as BroadcastChannel's do, one microtask later, and what was sent is kept in `sent`.
 */
export function fakeChannels(): { factory: ChannelFactory; sent: { name: string; data: unknown }[] } {
  const open = new Map<string, Set<ChannelLike>>();
  const sent: { name: string; data: unknown }[] = [];
  const factory: ChannelFactory = (name) => {
    const group = open.get(name) ?? new Set<ChannelLike>();
    open.set(name, group);
    const me: ChannelLike = {
      onmessage: null,
      postMessage(data) {
        sent.push({ name, data });
        // A structured clone, as a real channel makes.
        const copy = JSON.parse(JSON.stringify(data)) as unknown;
        for (const other of group) {
          if (other === me) continue;
          queueMicrotask(() => other.onmessage?.({ data: copy }));
        }
      },
      close() {
        group.delete(me);
      }
    };
    group.add(me);
    return me;
  };
  return { factory, sent };
}

/** Lets every queued microtask run, so a message sent has arrived. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
