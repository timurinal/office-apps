import { describe, expect, it, vi } from 'vitest';
import { channelName, newShowToken, parseMessage, ShowLink, SHOW_TOKEN, type ShowMessage } from './protocol';
import type { ShowState } from './state';
import { fakeChannels, flush } from './testing';

const state: ShowState = { rev: 3, by: 'win-a', slide: 's2', index: 1, screen: 'none', laser: false };

describe('a message from the channel', () => {
  it('is accepted in each of its five shapes', () => {
    const good: ShowMessage[] = [
      { t: 'hello', from: 'a' },
      { t: 'state', from: 'a', state },
      { t: 'pointer', from: 'a', at: { x: 0.25, y: 0.5 } },
      { t: 'pointer', from: 'a', at: null },
      { t: 'end', from: 'a' },
      { t: 'bye', from: 'a' }
    ];
    for (const m of good) expect(parseMessage(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('is refused when it is not an object, has no sender or an unknown kind', () => {
    for (const bad of [null, 5, 'state', [], {}, { t: 'hello' }, { t: 'hello', from: '' }, { t: 'launch', from: 'a' }, { t: 'hello', from: 'x'.repeat(500) }]) {
      expect(parseMessage(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('is refused when its state is malformed', () => {
    const wrap = (s: unknown) => parseMessage({ t: 'state', from: 'a', state: s });
    expect(wrap({ ...state, rev: -1 })).toBeNull();
    expect(wrap({ ...state, rev: 1.5 })).toBeNull();
    expect(wrap({ ...state, screen: 'purple' })).toBeNull();
    expect(wrap({ ...state, laser: 'yes' })).toBeNull();
    expect(wrap({ ...state, slide: 7 })).toBeNull();
    expect(wrap({ ...state, by: '' })).toBeNull();
    expect(wrap({ ...state, index: Number.NaN })).toBeNull();
    expect(wrap(null)).toBeNull();
    // A show with no slide is a state too.
    expect(wrap({ ...state, slide: null })).not.toBeNull();
  });

  it('keeps a laser position inside the slide and refuses one that is not a number', () => {
    expect(parseMessage({ t: 'pointer', from: 'a', at: { x: -3, y: 9 } })).toEqual({ t: 'pointer', from: 'a', at: { x: 0, y: 1 } });
    expect(parseMessage({ t: 'pointer', from: 'a', at: { x: 'left', y: 0 } })).toBeNull();
    expect(parseMessage({ t: 'pointer', from: 'a', at: { x: Number.NaN, y: 0 } })).toBeNull();
    expect(parseMessage({ t: 'pointer', from: 'a' })).toBeNull();
  });

  it('copies only the fields it knows, so nothing else rides along', () => {
    const m = parseMessage({ t: 'state', from: 'a', state: { ...state, extra: 'x' }, other: 1 });
    expect(m).toEqual({ t: 'state', from: 'a', state });
  });
});

describe('a show’s name', () => {
  it('is made from the document and the show, so two shows never share a channel', () => {
    expect(channelName('doc1', 'abc')).not.toBe(channelName('doc1', 'abd'));
    expect(channelName('doc1', 'abc')).not.toBe(channelName('doc2', 'abc'));
  });

  it('is a token the audience window’s address can carry', () => {
    for (let i = 0; i < 20; i++) expect(newShowToken()).toMatch(SHOW_TOKEN);
    expect(newShowToken()).not.toBe(newShowToken());
  });
});

describe('two windows on one channel', () => {
  const link = (factory: ReturnType<typeof fakeChannels>['factory'], id: string) => new ShowLink('show', id, factory);

  it('each hear the other and not themselves', async () => {
    const { factory } = fakeChannels();
    const a = link(factory, 'a');
    const b = link(factory, 'b');
    const heardA = vi.fn();
    const heardB = vi.fn();
    a.listen(heardA);
    b.listen(heardB);
    a.send({ t: 'state', state });
    await flush();
    expect(heardA).not.toHaveBeenCalled();
    expect(heardB).toHaveBeenCalledWith({ t: 'state', from: 'a', state });
  });

  it('ignore a message that is not one of ours', async () => {
    const { factory } = fakeChannels();
    const a = link(factory, 'a');
    const stranger = factory('show')!;
    const heard = vi.fn();
    a.listen(heard);
    stranger.postMessage({ t: 'state', from: 'z', state: { nonsense: true } });
    stranger.postMessage('hello');
    await flush();
    expect(heard).not.toHaveBeenCalled();
  });

  it('stop hearing and sending once closed', async () => {
    const { factory, sent } = fakeChannels();
    const a = link(factory, 'a');
    const b = link(factory, 'b');
    const heard = vi.fn();
    b.listen(heard);
    b.close();
    a.send({ t: 'hello' });
    b.send({ t: 'bye' });
    await flush();
    expect(heard).not.toHaveBeenCalled();
    expect(sent.filter((s) => (s.data as { from: string }).from === 'b')).toHaveLength(0);
  });

  it('say so where the browser has no channels, and send nothing', () => {
    const none = new ShowLink('show', 'a', () => null);
    expect(none.available).toBe(false);
    expect(() => none.send({ t: 'hello' })).not.toThrow();
    expect(() => none.close()).not.toThrow();
  });
});
