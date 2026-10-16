import { describe, expect, it, vi } from 'vitest';
import { clearLaunch, peekLaunch, PLAIN, setLaunch } from './launch';
import { SHOW_TOKEN } from './protocol';
import { audienceParams, audienceUrl, audienceWindowName, openAudienceWindow } from './window';

const q = (s: string) => new URLSearchParams(s);

describe('the audience window’s address', () => {
  it('is the same page with the audience and the show named', () => {
    expect(audienceUrl({ pathname: '/slides/abc', search: '' }, 'tok12345', 3)).toBe('/slides/abc?present=audience&show=tok12345&at=3');
  });

  it('keeps what else the address carries, and replaces what it had of its own', () => {
    const url = audienceUrl({ pathname: '/slides/abc', search: '?link=zz&present=audience&show=old&at=9' }, 'tok12345', 1);
    const params = new URL(url, 'https://office.test').searchParams;
    expect(params.get('link')).toBe('zz');
    expect(params.getAll('present')).toEqual(['audience']);
    expect(params.get('show')).toBe('tok12345');
    expect(params.get('at')).toBe('1');
  });

  it('stays on this origin, whatever the path begins with', () => {
    expect(audienceUrl({ pathname: '//evil.example/slides/abc', search: '' }, 'tok12345', 0).startsWith('/evil.example/')).toBe(true);
    expect(audienceUrl({ pathname: 'slides/abc', search: '' }, 'tok12345', 0).startsWith('/slides/abc?')).toBe(true);
  });

  it('is read back by audienceParams', () => {
    const url = audienceUrl({ pathname: '/slides/abc', search: '' }, 'tok12345', 7);
    expect(audienceParams(new URL(url, 'https://office.test').searchParams)).toEqual({ show: 'tok12345', at: 7 });
  });
});

describe('reading the address', () => {
  it('is not an audience window without present=audience', () => {
    expect(audienceParams(q(''))).toBeNull();
    expect(audienceParams(q('present=presenter&show=tok12345'))).toBeNull();
  });

  it('runs alone when there is no show, or one that is not a token', () => {
    expect(audienceParams(q('present=audience'))).toEqual({ show: null, at: 0 });
    expect(audienceParams(q('present=audience&show=../../x'))).toEqual({ show: null, at: 0 });
    expect(audienceParams(q('present=audience&show=' + 'a'.repeat(200)))).toEqual({ show: null, at: 0 });
  });

  it('starts at slide 0 when `at` is not a place in a deck', () => {
    for (const at of ['x', '-1', '2.5', '', '99999999']) expect(audienceParams(q(`present=audience&at=${at}`))!.at, at).toBe(0);
    expect(audienceParams(q('present=audience&at=12'))!.at).toBe(12);
  });
});

describe('opening the window', () => {
  it('names it for the show, so a second ask reuses it', () => {
    const open = vi.fn(() => ({}) as Window);
    openAudienceWindow('/slides/abc?x', 'tok12345', open as unknown as typeof window.open);
    expect(open).toHaveBeenCalledWith('/slides/abc?x', audienceWindowName('tok12345'), expect.stringContaining('popup'));
  });

  it('answers null where the browser refuses, whether by null or by throwing', () => {
    expect(openAudienceWindow('/x', 'tok12345', (() => null) as typeof window.open)).toBeNull();
    expect(
      openAudienceWindow('/x', 'tok12345', (() => {
        throw new Error('blocked');
      }) as typeof window.open)
    ).toBeNull();
  });

  it('has a name that is safe to give a window', () => {
    expect(audienceWindowName('tok12345')).toMatch(/^[A-Za-z0-9-]+$/);
    expect(SHOW_TOKEN.test('tok12345')).toBe(true);
  });
});

describe('what the next show starts as', () => {
  it('is a plain show unless a command asked otherwise', () => {
    clearLaunch();
    expect(peekLaunch()).toBe(PLAIN);
  });

  it('is what the command left, and reading it does not use it up', () => {
    const launch = { mode: 'presenter' as const, show: 'tok12345', audience: null };
    setLaunch(launch, 1000);
    expect(peekLaunch(1500)).toBe(launch);
    expect(peekLaunch(1600)).toBe(launch);
    clearLaunch();
    expect(peekLaunch(1700)).toBe(PLAIN);
  });

  it('goes stale, so an F5 later is not a presenter’s view', () => {
    setLaunch({ mode: 'presenter', show: 'tok12345', audience: null }, 1000);
    expect(peekLaunch(1000 + 5000)).toBe(PLAIN);
    clearLaunch();
  });
});
