import { describe, expect, it } from 'vitest';
import type { Transition } from '../model/deck';
import {
  animatedProperties,
  DEFAULT_DURATION,
  DEFAULT_FROM,
  durationOf,
  kindOf,
  plan,
  REDUCED_MAX,
  resolve,
  sideOf,
  SIDES,
  TRANSITION_KINDS,
  type Resolved
} from './transitions';

const play = (t: Transition | undefined, o: { backward?: boolean; reduced?: boolean } = {}) => resolve(t, { backward: o.backward ?? false, reduced: o.reduced ?? false });

describe('reading a transition from the deck', () => {
  it('has a cut for no transition, none and a kind it does not know', () => {
    expect(play(undefined)).toBeNull();
    expect(play({ kind: 'none' })).toBeNull();
    expect(play({ kind: 'spin' } as unknown as Transition)).toBeNull();
    expect(kindOf({ kind: 'spin' } as unknown as Transition)).toBe('none');
  });

  it('defaults the duration and the side, and keeps what the deck says', () => {
    expect(play({ kind: 'push' })).toMatchObject({ duration: DEFAULT_DURATION, from: DEFAULT_FROM });
    expect(play({ kind: 'wipe', duration: 900, from: 'top' })).toMatchObject({ duration: 900, from: 'top' });
  });

  it('survives a duration or a side that is not what the type says', () => {
    expect(durationOf({ kind: 'fade', duration: Number.NaN })).toBe(DEFAULT_DURATION);
    expect(durationOf({ kind: 'fade', duration: '800' as unknown as number })).toBe(DEFAULT_DURATION);
    expect(durationOf({ kind: 'fade', duration: -5 })).toBe(50);
    expect(durationOf({ kind: 'fade', duration: 9e9 })).toBe(60_000);
    expect(sideOf({ kind: 'push', from: 'diagonal' } as unknown as Transition)).toBe(DEFAULT_FROM);
  });

  it('takes a side only for push and wipe', () => {
    expect(play({ kind: 'fade', from: 'top' })!.from).toBe(DEFAULT_FROM);
    expect(play({ kind: 'zoom', from: 'top' })!.from).toBe(DEFAULT_FROM);
  });
});

describe('going back through the deck', () => {
  it('plays push and wipe from the opposite side', () => {
    expect(play({ kind: 'push', from: 'right' }, { backward: true })).toMatchObject({ from: 'left', reverse: true });
    expect(play({ kind: 'wipe', from: 'top' }, { backward: true })).toMatchObject({ from: 'bottom', reverse: true });
  });

  it('plays fade and zoom the same sides, with zoom reversed', () => {
    expect(play({ kind: 'fade' }, { backward: true })).toMatchObject({ reverse: true });
    const fwd = plan(play({ kind: 'zoom' })!);
    const back = plan(play({ kind: 'zoom' }, { backward: true })!);
    expect(back).not.toEqual(fwd);
  });
});

describe('reduced motion', () => {
  it('turns every transition into a fade', () => {
    for (const kind of TRANSITION_KINDS.filter((k) => k !== 'none')) {
      expect(play({ kind, duration: 800 }, { reduced: true }), kind).toMatchObject({ kind: 'fade' });
    }
  });

  it('keeps a fade short', () => {
    expect(play({ kind: 'push', duration: 4000 }, { reduced: true })!.duration).toBe(REDUCED_MAX);
    expect(play({ kind: 'push', duration: 200 }, { reduced: true })!.duration).toBe(200);
  });

  it('leaves a cut a cut', () => {
    expect(play({ kind: 'none' }, { reduced: true })).toBeNull();
    expect(play(undefined, { reduced: true })).toBeNull();
  });

  it('plays nothing but opacity', () => {
    const p = plan(play({ kind: 'wipe', from: 'left' }, { reduced: true })!);
    expect([...animatedProperties(p)]).toEqual(['opacity']);
  });
});

describe('what each kind animates', () => {
  const every = (): Resolved[] =>
    (['fade', 'push', 'wipe', 'zoom'] as const).flatMap((kind) =>
      SIDES.flatMap((from) => [false, true].map((reverse): Resolved => ({ kind, from, reverse, duration: 700 })))
    );

  it('is only transform and opacity, for every kind, side and direction', () => {
    for (const r of every()) {
      for (const prop of animatedProperties(plan(r))) expect(['transform', 'opacity'], `${r.kind} ${r.from} ${r.reverse}: ${prop}`).toContain(prop);
    }
  });

  it('never asks for a clip-path, a size or a position', () => {
    for (const r of every()) {
      const used = [...animatedProperties(plan(r))];
      for (const banned of ['clipPath', 'clip-path', 'width', 'height', 'left', 'top', 'right', 'bottom', 'margin', 'inset']) expect(used).not.toContain(banned);
    }
  });

  it('fades the new slide in over the old one, which stays under it', () => {
    const p = plan({ kind: 'fade', from: 'right', reverse: false, duration: 500 });
    expect(p.in).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(p.out).toBeNull();
    expect(p.duration).toBe(500);
  });

  it('pushes: the new slide comes in from the side while the old one goes out the other', () => {
    const p = plan({ kind: 'push', from: 'right', reverse: false, duration: 600 });
    expect(p.in).toEqual([{ transform: 'translate(100%, 0%)' }, { transform: 'translate(0%, 0%)' }]);
    expect(p.out).toEqual([{ transform: 'translate(0%, 0%)' }, { transform: 'translate(-100%, 0%)' }]);
    const up = plan({ kind: 'push', from: 'bottom', reverse: false, duration: 600 });
    expect(up.in?.[0]).toEqual({ transform: 'translate(0%, 100%)' });
  });

  it('wipes with a mask that moves in and a slide inside it that moves back by the same amount', () => {
    for (const from of SIDES) {
      const p = plan({ kind: 'wipe', from, reverse: false, duration: 700 });
      expect(p.out).toBeNull();
      expect(p.inner).not.toBeNull();
      const num = (frames: Keyframe[], i: number) => String(frames[i]!.transform).match(/-?\d+(\.\d+)?/g)!.map(Number);
      const [mx, my] = num(p.in, 0);
      const [ix, iy] = num(p.inner!, 0);
      expect(mx! + ix!).toBeCloseTo(0);
      expect(my! + iy!).toBeCloseTo(0);
      // The same end, so the slide is where it belongs when the mask has arrived.
      expect(p.in[1]).toEqual(p.inner![1]);
    }
  });

  it('zooms the old slide up and the new one in under no gap: the old one is never shrunk', () => {
    const p = plan({ kind: 'zoom', from: 'right', reverse: false, duration: 700 });
    expect(p.out).toEqual([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }]);
    expect(p.in[0]).toMatchObject({ opacity: 0 });
    expect(p.in[1]).toMatchObject({ opacity: 1 });
  });

  it('has one more animation than the kind needs: none', () => {
    expect(plan({ kind: 'fade', from: 'right', reverse: false, duration: 100 }).inner).toBeNull();
    expect(plan({ kind: 'push', from: 'right', reverse: false, duration: 100 }).inner).toBeNull();
  });
});
