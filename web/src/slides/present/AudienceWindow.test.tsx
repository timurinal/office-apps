// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Awareness } from 'y-protocols/awareness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentMeta } from '@shared/api';
import type { DocumentSource, SourceConnection, SourceEvents } from '../../docs/source';
import { CLOUD_FEATURES } from '../../docs/source';
import type { DeckJSON } from '../model/deck';
import { SlideModel } from '../model/model';
import { docOf, testDeck } from '../model/testing';
import { AudienceWindow } from './AudienceWindow';
import { audienceParams } from './window';
import { channelName, ShowLink, type ChannelFactory, type ShowMessage } from './protocol';
import { fakeChannels, flush } from './testing';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  // happy-dom lays nothing out: the surface is as big as a window.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function (this: HTMLElement) { return this.classList.contains('sp-surface') ? 1280 : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function (this: HTMLElement) { return this.classList.contains('sp-surface') ? 720 : 0; } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  const doc = document as unknown as Record<string, unknown>;
  delete doc.fullscreenEnabled;
});

const slides = (n: number, hidden: number[] = []): DeckJSON['slides'] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, layout: 'blank', elements: [], ...(hidden.includes(i) ? { hidden: true } : {}) }));

const meta = { id: 'doc', title: 'Kick-off', kind: 'slides' } as unknown as DocumentMeta;

/** A source whose room answers when the test says. */
function source(deck: DeckJSON) {
  const doc = docOf(deck);
  const awareness = new Awareness(doc);
  let events!: SourceEvents;
  const destroy = vi.fn();
  const src: DocumentSource = {
    kind: 'cloud',
    id: 'doc',
    features: CLOUD_FEATURES,
    connect: (e) => {
      events = e;
      return { doc, awareness, provider: null, destroy } as unknown as SourceConnection;
    }
  };
  return { src, doc, awareness, destroy, sync: () => act(() => events.onSynced(true)), unsync: () => act(() => events.onSynced(false)), stop: () => act(() => events.onStop('revoked')) };
}

// The audience's window uses the browser's own channels; this puts the fake ones in their place.
let factory: ChannelFactory;
vi.mock('./protocol', async (orig) => {
  const real = await orig<typeof import('./protocol')>();
  return { ...real, browserChannel: (name: string) => factory(name) };
});

const q = (sel: string) => document.body.querySelector(sel) as HTMLElement | null;
const shown = () => q('.sp-sr')?.textContent ?? null;
function keydown(k: string, over: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...over });
  act(() => void document.body.dispatchEvent(e));
  return e;
}
const settle = () => act(async () => void (await flush()));

function setup(o: { deck?: DeckJSON; show?: string | null; at?: number } = {}) {
  const fake = fakeChannels();
  factory = fake.factory;
  const s = source(o.deck ?? testDeck(slides(4)));
  const show = o.show === undefined ? 'tok12345' : o.show;
  act(() => root.render(<AudienceWindow source={s.src} meta={meta} show={show} at={o.at ?? 0} />));
  const link = new ShowLink(channelName('doc', show ?? 'none'), 'presenter-win', fake.factory);
  const heard: ShowMessage[] = [];
  link.listen((m) => heard.push(m));
  return { ...s, link, heard, fake };
}

describe('the audience’s window before the deck has come', () => {
  it('is the shape of a slide on black, and not a spinner or the word loading', () => {
    setup();
    const wait = q('.sp-wait')!;
    expect(wait.querySelector('.sp-skel-slide')).not.toBeNull();
    expect(wait.textContent).toBe('');
    expect(q('.sp-surface')).toBeNull();
  });
});

describe('the slide, once the deck has come', () => {
  it('is the slide and nothing else, on black', async () => {
    const t = setup({ at: 2 });
    t.sync();
    await settle();
    expect(q('.sp-root')!.getAttribute('data-theme')).toBe('dark');
    expect(shown()).toBe('Slide 3 of 4.');
    expect(q('.sp-surface .sl-view')).not.toBeNull();
    // No ribbon, no rail, no notes: nothing in the window but the show.
    expect(document.body.querySelectorAll('button').length).toBe(0);
  });

  it('follows the theme when somebody changes it in the editor', async () => {
    const t = setup();
    t.sync();
    await settle();
    const before = q('.sp-surface .sl-stage')!.style.background;
    const editor = new SlideModel(t.doc);
    act(() => void editor.setDesign({ theme: { ...testDeck().theme, colors: { ...testDeck().theme.colors, lt1: '#ffeedd' } }, master: { ...testDeck().master, bg: { kind: 'solid', color: { theme: 'lt1' } } }, layouts: testDeck().layouts }));
    expect(q('.sp-surface .sl-stage')!.style.background).not.toBe(before);
  });

  it('is named for the presentation, so the window can be told from the editor’s', async () => {
    const t = setup();
    t.sync();
    await settle();
    expect(document.title).toBe('Kick-off');
  });

  it('is not a person in the deck: no cursor and no avatar for it', async () => {
    const t = setup();
    t.sync();
    await settle();
    expect(t.awareness.getLocalState()).toBeNull();
  });

  it('starts on the slide in its address, past a hidden first slide', async () => {
    const t = setup({ deck: testDeck(slides(4, [0])), at: 0 });
    t.sync();
    await settle();
    expect(shown()).toBe('Slide 2 of 4.');
  });

  it('says once to press F, where the browser has full screen, and then stops', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    vi.useFakeTimers();
    const t = setup();
    t.sync();
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    expect(q('.sp-chip')!.textContent).toBe('Press F for full screen.');
    await act(async () => void (await vi.advanceTimersByTimeAsync(4500)));
    expect(q('.sp-chip')).toBeNull();
  });

  it('takes F11 for full screen, which Firefox has no other way to give a window a script opened', async () => {
    // F11 did nothing in the audience window in Zen.
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    const enter = vi.fn(() => Promise.resolve());
    (HTMLElement.prototype as unknown as { requestFullscreen: unknown }).requestFullscreen = enter;
    try {
      const t = setup();
      t.sync();
      await settle();
      const e = keydown('F11');
      expect(e.defaultPrevented).toBe(true);
      expect(enter).toHaveBeenCalledTimes(1);
      // With a key held with it, it is the browser's.
      expect(keydown('F11', { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(enter).toHaveBeenCalledTimes(1);
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).requestFullscreen;
    }
  });

  it('keeps the show, and its place, through a reconnect', async () => {
    const t = setup({ show: null });
    t.sync();
    await settle();
    keydown('ArrowRight');
    keydown('ArrowRight');
    t.unsync();
    expect(q('.sp-wait')).toBeNull();
    expect(shown()).toBe('Slide 3 of 4.');
    t.sync();
    expect(shown()).toBe('Slide 3 of 4.');
  });

  it('says nothing about full screen where the browser has none', async () => {
    const t = setup();
    t.sync();
    await settle();
    expect(q('.sp-chip')).toBeNull();
  });
});

describe('with the presenter’s window', () => {
  it('follows it: the slide the presenter is on', async () => {
    const t = setup();
    t.sync();
    await settle();
    // The presenter had gone on before this window opened; it answers hello with where it is.
    t.link.send({ t: 'state', state: { rev: 5, by: 'presenter-win', slide: 's3', index: 2, screen: 'none', laser: false } });
    await settle();
    expect(shown()).toBe('Slide 3 of 4.');
    t.link.send({ t: 'state', state: { rev: 6, by: 'presenter-win', slide: 's3', index: 2, screen: 'black', laser: false } });
    await settle();
    expect(q('.sp-screen')!.getAttribute('data-screen')).toBe('black');
  });

  it('says hello when it is ready, and the keys it takes go to the presenter’s window', async () => {
    const t = setup();
    t.sync();
    await settle();
    expect(t.heard.some((m) => m.t === 'hello')).toBe(true);
    keydown('ArrowRight');
    await settle();
    const last = [...t.heard].reverse().find((m): m is Extract<ShowMessage, { t: 'state' }> => m.t === 'state')!;
    expect(last.state.slide).toBe('s2');
  });

  it('draws the presenter’s laser', async () => {
    const t = setup();
    t.sync();
    await settle();
    t.link.send({ t: 'state', state: { rev: 5, by: 'presenter-win', slide: 's1', index: 0, screen: 'none', laser: true } });
    t.link.send({ t: 'pointer', at: { x: 0.5, y: 0.5 } });
    await settle();
    expect(q('.sp-surface')!.hasAttribute('data-laser')).toBe(true);
  });

  it('ends when the presenter ends, and tries to close itself', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const t = setup();
    t.sync();
    await settle();
    t.link.send({ t: 'end' });
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
    // A window that could not close says why it is empty, and offers the presentation.
    expect(q('.sp-surface')).toBeNull();
    expect(q('.sp-wait-note')!.textContent).toBe('The slide show has ended.');
  });

  it('ends both when Escape is pressed here', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const t = setup();
    t.sync();
    await settle();
    keydown('Escape');
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
    expect(t.heard.some((m) => m.t === 'end')).toBe(true);
  });
});

describe('on its own', () => {
  it('is a show of its own with no channel: the keys work and nothing is sent', async () => {
    const t = setup({ show: null });
    t.sync();
    await settle();
    keydown('ArrowRight');
    keydown('ArrowRight');
    expect(shown()).toBe('Slide 3 of 4.');
    expect(t.fake.sent).toHaveLength(0);
  });

  it('leaves the show at the end, as any show does', async () => {
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const t = setup({ show: null, deck: testDeck(slides(1)) });
    t.sync();
    await settle();
    keydown('ArrowRight');
    expect(q('.sp-screen')!.getAttribute('data-screen')).toBe('end');
    keydown('ArrowRight');
    expect(q('.sp-wait-note')!.textContent).toBe('The slide show has ended.');
  });
});

describe('when it cannot have the deck', () => {
  it('says so when access was withdrawn', async () => {
    const t = setup();
    t.sync();
    await settle();
    t.stop();
    expect(q('.sp-wait-note')!.textContent).toBe('You no longer have access to this presentation.');
  });
});

describe('its address', () => {
  it('is how the page knows to show this and not the editor', () => {
    expect(audienceParams(new URLSearchParams('present=audience&show=tok12345&at=2'))).toEqual({ show: 'tok12345', at: 2 });
    expect(audienceParams(new URLSearchParams(''))).toBeNull();
  });
});
