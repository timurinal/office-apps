import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLaunch, peekLaunch, PLAIN } from './launch';
import { SHOW_TOKEN } from './protocol';
import { POPUP_BLOCKED, startPresenterView } from './start';
import { audienceParams } from './window';

afterEach(() => clearLaunch());

const ctxOf = (order: string[], slideIndex: number) => ({ present: vi.fn(), slideIndex, notify: vi.fn(), model: { order: () => order } });
const here = { pathname: '/slides/doc1', search: '?link=abc' };

describe('starting the presenter’s view', () => {
  it('opens the audience’s window at the current slide, before the show starts', () => {
    const win = {} as Window;
    const calls: string[] = [];
    const open = vi.fn((_url: string, _show: string) => (calls.push('open'), win));
    const ctx = ctxOf(['a', 'b', 'c'], 2);
    ctx.present.mockImplementation(() => calls.push('present'));
    startPresenterView(ctx, here, open as never);
    // The window is opened in the click, ahead of anything the show does.
    expect(calls).toEqual(['open', 'present']);
    const url = new URL(open.mock.calls[0]![0], 'https://office.test');
    expect(url.pathname).toBe('/slides/doc1');
    expect(url.searchParams.get('link')).toBe('abc');
    const params = audienceParams(url.searchParams)!;
    expect(params.at).toBe(2);
    expect(params.show).toMatch(SHOW_TOKEN);
    expect(ctx.present).toHaveBeenCalledWith(2);
  });

  it('leaves the show what it needs: the presenter’s view, the same token, the window', () => {
    const win = {} as Window;
    const open = vi.fn((_url: string, _show: string) => win);
    startPresenterView(ctxOf(['a', 'b'], 0), here, open as never);
    const launch = peekLaunch();
    expect(launch.mode).toBe('presenter');
    expect(launch.audience).toBe(win);
    const url = new URL(open.mock.calls[0]![0] as string, 'https://office.test');
    expect(launch.show).toBe(url.searchParams.get('show'));
  });

  it('says so when the browser refuses the window, and still starts: the view offers to try again', () => {
    const ctx = ctxOf(['a', 'b'], 1);
    startPresenterView(ctx, here, (() => null) as never);
    expect(ctx.notify).toHaveBeenCalledWith({ text: POPUP_BLOCKED, tone: 'danger' });
    expect(ctx.present).toHaveBeenCalledWith(1);
    expect(peekLaunch()).toMatchObject({ mode: 'presenter', audience: null });
  });

  it('starts from the first slide when none is on the canvas', () => {
    const ctx = ctxOf(['a'], -1);
    startPresenterView(ctx, here, (() => ({}) as Window) as never);
    expect(ctx.present).toHaveBeenCalledWith(0);
  });

  it('does nothing for a deck with no slides: no window, no show, nothing left behind', () => {
    const ctx = ctxOf([], -1);
    const open = vi.fn();
    startPresenterView(ctx, here, open as never);
    expect(open).not.toHaveBeenCalled();
    expect(ctx.present).not.toHaveBeenCalled();
    expect(peekLaunch()).toBe(PLAIN);
  });

  it('gives each start a show of its own', () => {
    const open = vi.fn((_url: string, _show: string) => ({}) as Window);
    startPresenterView(ctxOf(['a'], 0), here, open as never);
    startPresenterView(ctxOf(['a'], 0), here, open as never);
    const token = (i: number) => new URL(open.mock.calls[i]![0] as string, 'https://office.test').searchParams.get('show');
    expect(token(0)).not.toBe(token(1));
  });
});
