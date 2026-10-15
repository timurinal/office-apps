// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckJSON, TextDoc } from '../model/deck';
import type { SlideModel } from '../model/model';
import { modelOf, testDeck, txt } from '../model/testing';
import type { SlidesContext } from '../modules/types';
import { NOTES_SIZE, PresenterView } from './Console';
import type { Launch } from './launch';
import { channelName, ShowLink, type ShowMessage } from './protocol';
import { POPUP_BLOCKED } from './start';
import { fakeChannels, flush } from './testing';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  // happy-dom lays nothing out: the next slide's box is as wide as this says.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function (this: HTMLElement) { return this.classList.contains('sp-next-fit') ? 320 : 0; } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  try {
    localStorage.clear();
  } catch {
    // none
  }
});
afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface S {
  id: string;
  hidden?: boolean;
  notes?: TextDoc;
  title?: string;
}
const slides = (list: S[]): DeckJSON['slides'] =>
  list.map((s) => ({
    id: s.id,
    layout: 'blank',
    elements: s.title ? [{ type: 'shape' as const, shape: 'rect' as const, x: 0, y: 0, w: 100, h: 100, ph: { type: 'title' as const }, text: txt(s.title) }] : [],
    ...(s.hidden ? { hidden: true } : {}),
    ...(s.notes ? { notes: s.notes } : {})
  }));

const fakeWindow = () => ({ closed: false, close: vi.fn(), focus: vi.fn() }) as unknown as Window & { close: ReturnType<typeof vi.fn> };

function setup(model: SlideModel, o: { from?: number; audience?: Window | null; show?: string } = {}) {
  const { factory, sent } = fakeChannels();
  const select = vi.fn();
  const close = vi.fn();
  const notify = vi.fn();
  const ctx = { model, design: model.design(), select: { slide: select }, meta: { id: 'doc' }, notify } as unknown as SlidesContext;
  const launch: Launch = { mode: 'presenter', show: o.show ?? 'tok12345', audience: o.audience === undefined ? null : o.audience };
  act(() => root.render(<PresenterView ctx={ctx} from={o.from ?? 0} close={close} launch={launch} factory={factory} />));
  // The audience's end of the channel, as a test drives it.
  const link = new ShowLink(channelName('doc', launch.show!), 'audience-win', factory);
  const heard: ShowMessage[] = [];
  link.listen((m) => heard.push(m));
  return { ctx, close, select, notify, link, heard, sent, factory };
}

const q = (sel: string) => document.body.querySelector(sel) as HTMLElement | null;
const text = (sel: string) => q(sel)?.textContent ?? null;
const button = (label: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
const click = (el: Element | undefined) => act(() => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
function keydown(k: string, over: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...over });
  act(() => void target.dispatchEvent(e));
  return e;
}
const settle = () => act(async () => void (await flush()));

const deck = (): SlideModel =>
  modelOf(
    testDeck(
      slides([
        { id: 's1', title: 'Kick-off', notes: txt('Start with the forty.', 'Pause for questions.') },
        { id: 's2', hidden: true, title: 'Hidden one' },
        { id: 's3', title: 'What we ship' },
        { id: 's4', title: 'Thanks', notes: txt('Say thank you.') }
      ])
    )
  );

describe('the presenter’s view', () => {
  it('is a dialog on the body, with the place in the deck, the next slide and the notes', () => {
    setup(deck());
    expect(q('.sp-console')!.getAttribute('role')).toBe('dialog');
    expect(q('.sp-console')!.getAttribute('aria-label')).toBe('Presenter view');
    expect(text('.sp-where')).toBe('Slide 1 of 4');
    expect(q('[aria-label="Next slide"] .sl-view')).not.toBeNull();
    expect(text('[aria-label="Speaker notes"]')).toContain('Start with the forty.');
    expect(text('[aria-label="Speaker notes"]')).toContain('Pause for questions.');
  });

  it('shows the next slide that is not hidden, and the end of the show after the last', () => {
    setup(deck());
    const next = () => q('[aria-label="Next slide"]')!;
    keydown('ArrowRight');
    // From slide 1 the next is slide 3: the hidden slide 2 is skipped.
    expect(text('.sp-where')).toBe('Slide 3 of 4');
    expect(next().querySelector('.sl-view')).not.toBeNull();
    keydown('ArrowRight');
    expect(text('.sp-where')).toBe('Slide 4 of 4');
    expect(next().querySelector('.sl-view')).toBeNull();
    expect(next().textContent).toContain('End of slide show');
  });

  it('follows the slide with its notes, and says when there are none', () => {
    setup(deck());
    keydown('ArrowRight');
    expect(text('.sp-notes-body')).toBe('No notes for this slide.');
    keydown('ArrowRight');
    expect(text('.sp-notes-body')).toBe('Say thank you.');
  });

  it('follows the notes as somebody edits them', () => {
    const m = deck();
    setup(m);
    act(() => void m.setNotes('s1', txt('Changed in the middle of the talk.')));
    expect(text('.sp-notes-body')).toBe('Changed in the middle of the talk.');
  });
});

describe('the size of the notes', () => {
  it('grows and shrinks in steps, within a range, and is remembered', () => {
    setup(deck());
    const body = () => q('.sp-notes-body')!;
    expect(body().style.fontSize).toBe(`${NOTES_SIZE.initial}px`);
    click(button('Larger text'));
    expect(body().style.fontSize).toBe(`${NOTES_SIZE.initial + NOTES_SIZE.step}px`);
    click(button('Smaller text'));
    click(button('Smaller text'));
    expect(body().style.fontSize).toBe(`${NOTES_SIZE.initial - NOTES_SIZE.step}px`);
    expect(localStorage.getItem('oa-slides-notes-size')).toBe(String(NOTES_SIZE.initial - NOTES_SIZE.step));
    for (let i = 0; i < 30; i++) click(button('Smaller text'));
    expect(body().style.fontSize).toBe(`${NOTES_SIZE.min}px`);
    expect(button('Smaller text')!.disabled).toBe(true);
    for (let i = 0; i < 40; i++) click(button('Larger text'));
    expect(body().style.fontSize).toBe(`${NOTES_SIZE.max}px`);
    expect(button('Larger text')!.disabled).toBe(true);
  });

  it('starts from the size it was left at', () => {
    localStorage.setItem('oa-slides-notes-size', '34');
    setup(deck());
    expect(q('.sp-notes-body')!.style.fontSize).toBe('34px');
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    setup(deck());
    click(button('Larger text'));
    expect(q('.sp-notes-body')!.style.fontSize).toBe(`${NOTES_SIZE.initial + NOTES_SIZE.step}px`);
  });
});

describe('the timer and the clock', () => {
  it('counts from the start, pauses, resumes and resets', () => {
    vi.useFakeTimers();
    setup(deck());
    expect(text('.sp-time')).toBe('0:00');
    act(() => void vi.advanceTimersByTime(5000));
    expect(text('.sp-time')).toBe('0:05');
    click(button('Pause timer'));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(text('.sp-time')).toBe('0:05');
    click(button('Resume timer'));
    act(() => void vi.advanceTimersByTime(3000));
    expect(text('.sp-time')).toBe('0:08');
    click(button('Reset timer'));
    expect(text('.sp-time')).toBe('0:00');
    act(() => void vi.advanceTimersByTime(2000));
    expect(text('.sp-time')).toBe('0:02');
  });

  it('shows the time of day', () => {
    setup(deck());
    expect(text('.sp-clock')).toMatch(/\d{1,2}[:.]\d{2}/);
  });
});

describe('the buttons and the keys', () => {
  it('Next and Previous move the show, and the keys do the same', () => {
    setup(deck());
    click(button('Next'));
    expect(text('.sp-where')).toBe('Slide 3 of 4');
    click(button('Previous'));
    expect(text('.sp-where')).toBe('Slide 1 of 4');
    keydown('ArrowRight');
    expect(text('.sp-where')).toBe('Slide 3 of 4');
  });

  it('the black screen and the laser are buttons that stay pressed, and keys too', () => {
    setup(deck());
    click(button('Black screen'));
    expect(button('Black screen')!.getAttribute('aria-pressed')).toBe('true');
    expect(text('.sp-cur-note')).toBe('Black screen');
    // The presenter still sees the slide: the black is the audience's.
    expect(q('.sp-cur .sp-screen')).toBeNull();
    keydown('b');
    expect(button('Black screen')!.getAttribute('aria-pressed')).toBe('false');
    click(button('Laser'));
    expect(button('Laser')!.getAttribute('aria-pressed')).toBe('true');
    keydown('l');
    expect(button('Laser')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('gives the keyboard back to the show after a button, so Space is Next again', () => {
    setup(deck());
    click(button('Laser'));
    expect(document.activeElement).toBe(q('.sp-console'));
    keydown(' ');
    expect(text('.sp-where')).toBe('Slide 3 of 4');
  });

  it('lets Enter press the button that has focus, and does not take it for Next', () => {
    setup(deck());
    const laser = button('Laser')!;
    laser.focus();
    const e = keydown('Enter', {}, laser);
    expect(e.defaultPrevented).toBe(false);
    expect(text('.sp-where')).toBe('Slide 1 of 4');
  });

  it('moves among the buttons with Tab and keeps the focus inside the view', () => {
    setup(deck());
    const all = [...document.body.querySelectorAll<HTMLElement>('.sp-console button:not(:disabled)')];
    const press = (over?: KeyboardEventInit) => keydown('Tab', over, document.activeElement ?? document.body);
    press();
    expect(document.activeElement).toBe(all[0]);
    press({ shiftKey: true });
    expect(document.activeElement).toBe(all[all.length - 1]);
    press();
    expect(document.activeElement).toBe(all[0]);
  });

  it('is not advanced by a click on its copy of the slide', () => {
    setup(deck());
    const surface = q('.sp-cur .sp-surface')!;
    for (const type of ['pointerdown', 'pointerup']) act(() => void surface.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 5, clientY: 5, button: 0 })));
    expect(text('.sp-where')).toBe('Slide 1 of 4');
  });
});

describe('the audience’s window', () => {
  it('is told where the show is, and what it does is done here', async () => {
    const t = setup(deck());
    t.link.send({ t: 'hello' });
    await settle();
    expect(t.heard.some((m) => m.t === 'state' && m.state.slide === 's1')).toBe(true);
    keydown('ArrowRight');
    await settle();
    const last = [...t.heard].reverse().find((m): m is Extract<ShowMessage, { t: 'state' }> => m.t === 'state')!;
    expect(last.state.slide).toBe('s3');
    // The audience's window takes the next slide from its own keyboard.
    t.link.send({ t: 'state', state: { ...last.state, rev: last.state.rev + 1, by: 'zzz', slide: 's4', index: 3 } });
    await settle();
    expect(text('.sp-where')).toBe('Slide 4 of 4');
  });

  it('is open once it has said hello, and closed once it has said goodbye, with a way to open it again', async () => {
    const t = setup(deck());
    expect(button('Open audience window')).toBeDefined();
    t.link.send({ t: 'hello' });
    await settle();
    expect(text('.sp-bar')).toContain('Audience window open');
    expect(button('Open audience window')).toBeUndefined();
    t.link.send({ t: 'bye' });
    await settle();
    expect(text('.sp-bar')).toContain('Audience window closed');
    expect(button('Open audience window')).toBeDefined();
  });

  it('is opening while the window it opened has not yet said hello', async () => {
    const t = setup(deck(), { audience: fakeWindow() });
    expect(text('.sp-bar')).toContain('Audience window opening');
    t.link.send({ t: 'hello' });
    await settle();
    expect(text('.sp-bar')).toContain('Audience window open');
    expect(text('.sp-bar')).not.toContain('opening');
  });

  it('opens again from the button, at the slide the show is on, and says so if the browser refuses', async () => {
    const t = setup(deck());
    keydown('ArrowRight');
    const popup = fakeWindow();
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    click(button('Open audience window'));
    expect(open).toHaveBeenCalledTimes(1);
    const url = new URL(String(open.mock.calls[0]![0]), 'https://office.test');
    expect(url.searchParams.get('present')).toBe('audience');
    expect(url.searchParams.get('show')).toBe('tok12345');
    expect(url.searchParams.get('at')).toBe('2');
    open.mockReturnValue(null);
    click(button('Open audience window'));
    expect(t.notify).toHaveBeenCalledWith({ text: POPUP_BLOCKED, tone: 'danger' });
  });

  it('is closed with the show: End show tells it, and closes the window it opened', async () => {
    const popup = fakeWindow();
    const t = setup(deck(), { audience: popup });
    keydown('ArrowRight');
    click(button('End show'));
    await settle();
    expect(t.close).toHaveBeenCalledTimes(1);
    expect(popup.close).toHaveBeenCalled();
    expect(t.heard.some((m) => m.t === 'end')).toBe(true);
    // The editor is where the show ended.
    expect(t.select).toHaveBeenCalledWith('s3');
  });

  it('ends here when the audience’s window ends it', async () => {
    const popup = fakeWindow();
    const t = setup(deck(), { audience: popup });
    t.link.send({ t: 'hello' });
    await settle();
    t.link.send({ t: 'end' });
    await settle();
    expect(t.close).toHaveBeenCalledTimes(1);
  });

  it('is kept when the audience’s window is closed by hand: the show goes on', async () => {
    const popup = fakeWindow();
    const t = setup(deck(), { audience: popup });
    t.link.send({ t: 'hello' });
    await settle();
    t.link.send({ t: 'bye' });
    await settle();
    expect(t.close).not.toHaveBeenCalled();
    keydown('ArrowRight');
    expect(text('.sp-where')).toBe('Slide 3 of 4');
  });
});
