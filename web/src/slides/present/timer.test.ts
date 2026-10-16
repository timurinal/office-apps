import { describe, expect, it } from 'vitest';
import { formatElapsed, Stopwatch } from './timer';

const clock = () => {
  let t = 1000;
  return { now: () => t, tick: (ms: number) => void (t += ms) };
};

describe('the presenter’s timer', () => {
  it('counts from the moment the show starts', () => {
    const c = clock();
    const w = new Stopwatch(c.now);
    c.tick(5000);
    expect(w.elapsed()).toBe(5000);
    expect(w.running).toBe(true);
  });

  it('stops counting while paused and carries on from where it was', () => {
    const c = clock();
    const w = new Stopwatch(c.now);
    c.tick(3000);
    w.pause();
    c.tick(60_000);
    expect(w.elapsed()).toBe(3000);
    w.start();
    c.tick(2000);
    expect(w.elapsed()).toBe(5000);
  });

  it('toggles', () => {
    const c = clock();
    const w = new Stopwatch(c.now);
    w.toggle();
    expect(w.running).toBe(false);
    w.toggle();
    expect(w.running).toBe(true);
  });

  it('resets to nothing: a running timer runs on from zero, a paused one stays at zero', () => {
    const c = clock();
    const w = new Stopwatch(c.now);
    c.tick(9000);
    w.reset();
    expect(w.elapsed()).toBe(0);
    c.tick(1500);
    expect(w.elapsed()).toBe(1500);
    w.pause();
    w.reset();
    c.tick(5000);
    expect(w.elapsed()).toBe(0);
    expect(w.running).toBe(false);
  });

  it('starting or pausing twice changes nothing', () => {
    const c = clock();
    const w = new Stopwatch(c.now);
    c.tick(1000);
    w.start();
    c.tick(1000);
    expect(w.elapsed()).toBe(2000);
    w.pause();
    w.pause();
    c.tick(5000);
    expect(w.elapsed()).toBe(2000);
  });

  it('can be made paused', () => {
    const c = clock();
    const w = new Stopwatch(c.now, false);
    c.tick(4000);
    expect(w.elapsed()).toBe(0);
  });
});

describe('how a time is written', () => {
  it('is minutes and seconds, and hours past the first', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7_900)).toBe('0:07');
    expect(formatElapsed(247_000)).toBe('4:07');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});
