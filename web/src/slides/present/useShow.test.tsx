// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckJSON } from '../model/deck';
import type { SlideModel } from '../model/model';
import { modelOf, peerOf, sync, testDeck } from '../model/testing';
import { channelName, ShowLink } from './protocol';
import { fakeChannels, flush } from './testing';
import { DIGITS_MS, useShow, type Role, type ShowHandle } from './useShow';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const key = (k: string, over: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...over });

const slides = (n: number, hidden: number[] = []): DeckJSON['slides'] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, layout: 'blank', elements: [], ...(hidden.includes(i) ? { hidden: true } : {}) }));

interface Win {
  handle: { current: ShowHandle | null };
  exited: ReturnType<typeof vi.fn>;
  fullscreen: ReturnType<typeof vi.fn>;
  root: Root;
  host: HTMLElement;
  model: SlideModel;
  unmount: () => void;
}

const wins: Win[] = [];
afterEach(() => {
  for (const w of wins.splice(0)) {
    act(() => w.root.unmount());
    w.host.remove();
  }
});
beforeEach(() => void 0);

function open(model: SlideModel, role: Role, from: number, channel?: { name: string; factory: ReturnType<typeof fakeChannels>['factory'] }): Win {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const handle: Win['handle'] = { current: null };
  const exited = vi.fn();
  const fullscreen = vi.fn();
  function Probe() {
    handle.current = useShow({ model, from, role, channel, onExit: exited, onFullscreen: fullscreen });
    return null;
  }
  act(() => root.render(<Probe />));
  const win: Win = { handle, exited, fullscreen, root, host, model, unmount: () => act(() => root.unmount()) };
  wins.push(win);
  return win;
}

const press = (w: Win, k: string, over?: Partial<KeyboardEvent>) => act(async () => void w.handle.current!.key(key(k, over)));
const settle = () => act(async () => void (await flush()));
const at = (w: Win) => w.handle.current!.state.slide;

/** A presenter's window and an audience's, on two clients of one deck. */
async function pair(n = 5, hidden: number[] = []) {
  const { factory, sent } = fakeChannels();
  const name = channelName('doc', 'show1234');
  const a = modelOf(testDeck(slides(n, hidden)));
  const b = peerOf(a.doc);
  const presenter = open(a, 'presenter', 0, { name, factory });
  const audience = open(b, 'audience', 0, { name, factory });
  await settle();
  return { presenter, audience, a, b, factory, sent, name };
}

describe('one window on its own', () => {
  it('starts on the slide asked for and steps through the deck', async () => {
    const w = open(modelOf(testDeck(slides(4))), 'solo', 1);
    expect(at(w)).toBe('s2');
    await press(w, 'ArrowRight');
    expect(at(w)).toBe('s3');
    await press(w, 'ArrowLeft');
    await press(w, 'ArrowLeft');
    expect(at(w)).toBe('s1');
    expect(w.handle.current!.index).toBe(0);
    expect(w.handle.current!.count).toBe(4);
  });

  it('skips hidden slides, and reaches one by typing its number', async () => {
    const w = open(modelOf(testDeck(slides(5, [1, 2]))), 'solo', 0);
    await press(w, ' ');
    expect(at(w)).toBe('s4');
    await press(w, '3');
    expect(w.handle.current!.digits).toBe('3');
    await press(w, 'Enter');
    expect(at(w)).toBe('s3');
    expect(w.handle.current!.digits).toBe('');
  });

  it('shows the end of the show after the last slide and leaves on the press after', async () => {
    const w = open(modelOf(testDeck(slides(2))), 'solo', 1);
    await press(w, 'ArrowRight');
    expect(w.handle.current!.state.screen).toBe('end');
    expect(w.exited).not.toHaveBeenCalled();
    await press(w, 'ArrowRight');
    expect(w.exited).toHaveBeenCalledTimes(1);
  });

  it('leaves on Escape, once, however many times it is asked', async () => {
    const w = open(modelOf(testDeck(slides(2))), 'solo', 0);
    await press(w, 'Escape');
    await press(w, 'Escape');
    act(() => w.handle.current!.end());
    expect(w.exited).toHaveBeenCalledTimes(1);
  });

  it('takes B, W and L as screens and the laser, and F as a call for full screen', async () => {
    const w = open(modelOf(testDeck(slides(2))), 'solo', 0);
    await press(w, 'b');
    expect(w.handle.current!.state.screen).toBe('black');
    await press(w, 'w');
    expect(w.handle.current!.state.screen).toBe('white');
    await press(w, 'w');
    expect(w.handle.current!.state.screen).toBe('none');
    await press(w, 'l');
    expect(w.handle.current!.state.laser).toBe(true);
    await press(w, 'f');
    expect(w.fullscreen).toHaveBeenCalledTimes(1);
    expect(w.handle.current!.state.laser).toBe(true);
  });

  it('says whether it took a key, and takes the ones the page must not see', async () => {
    const w = open(modelOf(testDeck(slides(2))), 'solo', 0);
    expect(w.handle.current!.key(key('x'))).toBe(true);
    expect(w.handle.current!.key(key('r', { ctrlKey: true }))).toBe(false);
  });

  it('forgets digits that were never followed by Enter', async () => {
    vi.useFakeTimers();
    try {
      const w = open(modelOf(testDeck(slides(12))), 'solo', 0);
      await press(w, '1');
      await press(w, '2');
      expect(w.handle.current!.digits).toBe('12');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DIGITS_MS + 50);
      });
      expect(w.handle.current!.digits).toBe('');
      await press(w, 'Enter');
      expect(at(w)).toBe('s2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('has no show, and says so by leaving, in a deck with no slides', () => {
    const w = open(modelOf(testDeck([])), 'solo', 0);
    expect(w.handle.current).toBeNull();
    expect(w.exited).toHaveBeenCalledTimes(1);
  });
});

describe('the deck changing while it runs', () => {
  it('goes to the slide that took the place of the one that was deleted', async () => {
    const m = modelOf(testDeck(slides(4)));
    const w = open(m, 'solo', 1);
    act(() => void m.deleteSlides(['s2']));
    expect(at(w)).toBe('s3');
    expect(w.handle.current!.count).toBe(3);
    expect(w.handle.current!.index).toBe(1);
  });

  it('follows a slide that is moved, so the next is still the one after it', async () => {
    const m = modelOf(testDeck(slides(4)));
    const w = open(m, 'solo', 1);
    act(() => void m.moveSlides(['s2'], 4));
    expect(at(w)).toBe('s2');
    expect(w.handle.current!.index).toBe(3);
    await press(w, 'ArrowRight');
    expect(w.handle.current!.state.screen).toBe('end');
  });

  it('leaves when every slide has been deleted: two people each delete one of the last two', async () => {
    // The model keeps the last slide from the person who would delete it, but two people can each delete one.
    const a = modelOf(testDeck(slides(2)));
    const b = peerOf(a.doc);
    const w = open(a, 'solo', 0);
    act(() => void a.deleteSlides(['s1']));
    b.deleteSlides(['s2']);
    act(() => sync(a.doc, b.doc));
    expect(a.order()).toEqual([]);
    expect(w.exited).toHaveBeenCalledTimes(1);
  });

  it('skips a slide hidden after the show began', async () => {
    const m = modelOf(testDeck(slides(4)));
    const w = open(m, 'solo', 0);
    act(() => void m.setSlides(['s2'], { hidden: true }));
    await press(w, 'ArrowRight');
    expect(at(w)).toBe('s3');
  });
});

describe('two windows on one show', () => {
  it('start together: the audience’s window takes the presenter’s place when it opens', async () => {
    const { factory } = fakeChannels();
    const name = channelName('doc', 'show1234');
    const a = modelOf(testDeck(slides(5)));
    const presenter = open(a, 'presenter', 2, { name, factory });
    await press(presenter, 'ArrowRight');
    const audience = open(peerOf(a.doc), 'audience', 0, { name, factory });
    await settle();
    expect(at(audience)).toBe('s4');
    expect(audience.handle.current!.index).toBe(3);
  });

  it('either window’s keys drive both', async () => {
    const { presenter, audience } = await pair();
    await press(presenter, 'ArrowRight');
    await settle();
    expect(at(audience)).toBe('s2');
    await press(audience, 'ArrowRight');
    await settle();
    expect(at(presenter)).toBe('s3');
    await press(audience, 'End');
    await settle();
    expect(at(presenter)).toBe('s5');
    await press(presenter, 'Home');
    await settle();
    expect(at(audience)).toBe('s1');
  });

  it('settle on one slide when both press at once', async () => {
    const { presenter, audience } = await pair();
    await act(async () => {
      presenter.handle.current!.key(key('ArrowRight'));
      audience.handle.current!.key(key('ArrowRight'));
      await flush();
    });
    expect(at(presenter)).toBe(at(audience));
    expect(presenter.handle.current!.state).toEqual(audience.handle.current!.state);
  });

  it('keep going from the slide both agree on after they pressed at once', async () => {
    const { presenter, audience } = await pair();
    await act(async () => {
      presenter.handle.current!.key(key('ArrowRight'));
      audience.handle.current!.key(key('ArrowRight'));
      await flush();
    });
    const was = at(presenter);
    await press(presenter, 'ArrowRight');
    await settle();
    expect(at(audience)).not.toBe(was);
    expect(at(audience)).toBe(at(presenter));
  });

  it('share the black screen and the laser, and the laser’s place', async () => {
    const { presenter, audience } = await pair();
    await press(presenter, 'b');
    await press(presenter, 'l');
    await settle();
    expect(audience.handle.current!.state.screen).toBe('black');
    expect(audience.handle.current!.state.laser).toBe(true);
    act(() => presenter.handle.current!.pointer({ x: 0.25, y: 0.75 }));
    await settle();
    expect(audience.handle.current!.remote).toEqual({ x: 0.25, y: 0.75 });
    act(() => presenter.handle.current!.pointer(null));
    await settle();
    expect(audience.handle.current!.remote).toBeNull();
  });

  it('step past the same hidden slides in both, because each reads its own deck', async () => {
    const { presenter, audience } = await pair(5, [1, 2]);
    await press(audience, 'ArrowRight');
    await settle();
    expect(at(presenter)).toBe('s4');
  });

  it('end in both when either ends: the audience’s Escape', async () => {
    const { presenter, audience } = await pair();
    await press(audience, 'Escape');
    await settle();
    expect(audience.exited).toHaveBeenCalledTimes(1);
    expect(presenter.exited).toHaveBeenCalledTimes(1);
  });

  it('end in both when either ends: the presenter’s Escape', async () => {
    const { presenter, audience } = await pair();
    await press(presenter, 'Escape');
    await settle();
    expect(audience.exited).toHaveBeenCalledTimes(1);
    expect(presenter.exited).toHaveBeenCalledTimes(1);
  });

  it('end in both on the press after the end of the show', async () => {
    const { presenter, audience } = await pair(2);
    await press(audience, 'End');
    await press(audience, 'ArrowRight');
    await settle();
    expect(presenter.handle.current!.state.screen).toBe('end');
    await press(presenter, 'ArrowRight');
    await settle();
    expect(audience.exited).toHaveBeenCalledTimes(1);
    expect(presenter.exited).toHaveBeenCalledTimes(1);
  });

  it('count the other window while it is open, and when it closes leave the show running', async () => {
    const { presenter, audience } = await pair();
    expect(presenter.handle.current!.peers).toBe(1);
    expect(presenter.handle.current!.heard).toBe(true);
    audience.unmount();
    await settle();
    expect(presenter.handle.current!.peers).toBe(0);
    expect(presenter.handle.current!.heard).toBe(true);
    expect(presenter.exited).not.toHaveBeenCalled();
    await press(presenter, 'ArrowRight');
    expect(at(presenter)).toBe('s2');
  });

  it('keep the slides in step through a deck that changes under both', async () => {
    const { presenter, audience, a, b } = await pair(5);
    await press(presenter, 'ArrowRight');
    await press(presenter, 'ArrowRight');
    await settle();
    expect(at(audience)).toBe('s3');
    // Someone deletes the slide on screen, and both clients see it.
    act(() => void a.deleteSlides(['s3']));
    sync(a.doc, b.doc);
    await settle();
    expect(at(presenter)).toBe('s4');
    expect(at(audience)).toBe('s4');
  });

  it('tell the presenter’s window ended when the page is hidden, and the audience’s window only left', async () => {
    const { factory, sent } = fakeChannels();
    const name = channelName('doc', 'show1234');
    const presenter = open(modelOf(testDeck(slides(3))), 'presenter', 0, { name, factory });
    await settle();
    sent.length = 0;
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(sent.map((s) => (s.data as { t: string }).t)).toContain('end');
    presenter.unmount();
    const audience = open(modelOf(testDeck(slides(3))), 'audience', 0, { name, factory });
    await settle();
    sent.length = 0;
    act(() => void window.dispatchEvent(new Event('pagehide')));
    const kinds = sent.map((s) => (s.data as { t: string }).t);
    expect(kinds).toContain('bye');
    expect(kinds).not.toContain('end');
    audience.unmount();
  });

  it('ignore what is not a show message on their channel', async () => {
    const { presenter, factory } = await pair();
    const stranger = factory(channelName('doc', 'show1234'))!;
    const before = presenter.handle.current!.state;
    stranger.postMessage({ t: 'state', from: 'x', state: { rev: 99, by: 'x', slide: 's5', index: 4, screen: 'purple', laser: false } });
    stranger.postMessage({ t: 'end' });
    stranger.postMessage('end');
    await settle();
    expect(presenter.handle.current!.state).toBe(before);
    expect(presenter.exited).not.toHaveBeenCalled();
  });

  it('do not hear another show’s window, or another deck’s', async () => {
    const { presenter, factory } = await pair();
    const other = new ShowLink(channelName('doc', 'other999'), 'zzz', factory);
    const another = new ShowLink(channelName('doc2', 'show1234'), 'yyy', factory);
    other.send({ t: 'end' });
    another.send({ t: 'end' });
    await settle();
    expect(presenter.exited).not.toHaveBeenCalled();
  });

  it('work as one window where there are no channels', async () => {
    const w = open(modelOf(testDeck(slides(3))), 'presenter', 0, { name: 'x', factory: () => null });
    await press(w, 'ArrowRight');
    expect(at(w)).toBe('s2');
    expect(w.handle.current!.peers).toBe(0);
  });
});
