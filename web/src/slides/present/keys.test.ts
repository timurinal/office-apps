import { describe, expect, it } from 'vitest';
import { onKey, type KeyLike } from './keys';

const key = (k: string, over: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...over });
const type = (k: string, over?: Partial<KeyLike>, digits = '') => onKey(key(k, over), digits).action?.type ?? null;

describe('keys that move along the deck', () => {
  it('go next on → ↓ Space PageDown Enter and N', () => {
    for (const k of ['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter', 'n', 'N']) expect(type(k), k).toBe('next');
  });

  it('go back on ← ↑ PageUp Backspace and P', () => {
    for (const k of ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P']) expect(type(k), k).toBe('prev');
  });

  it('go to the first and the last slide on Home and End', () => {
    expect(type('Home')).toBe('first');
    expect(type('End')).toBe('last');
  });

  it('keep moving while a key is held', () => {
    expect(type('ArrowRight', { repeat: true })).toBe('next');
  });
});

describe('a slide number', () => {
  it('collects digits and takes none of them as an action', () => {
    const a = onKey(key('1'), '');
    expect(a).toEqual({ handled: true, action: null, digits: '1' });
    expect(onKey(key('2'), a.digits)).toEqual({ handled: true, action: null, digits: '12' });
  });

  it('goes there on Enter, and Enter with none typed is next', () => {
    expect(onKey(key('Enter'), '12')).toEqual({ handled: true, action: { type: 'goto', n: 12 }, digits: '' });
    expect(type('Enter', undefined, '')).toBe('next');
  });

  it('takes Backspace as an erase while there are digits, and as previous when there are none', () => {
    expect(onKey(key('Backspace'), '12')).toEqual({ handled: true, action: null, digits: '1' });
    expect(onKey(key('Backspace'), '')).toMatchObject({ action: { type: 'prev' } });
  });

  it('keeps the last three digits, as a deck has at most 500 slides', () => {
    expect(onKey(key('7'), '123').digits).toBe('237');
  });

  it('is forgotten by a key that moves', () => {
    expect(onKey(key('ArrowRight'), '12').digits).toBe('');
  });
});

describe('the screen, the laser, full screen and leaving', () => {
  it('B and . blank black, W and , blank white', () => {
    expect(onKey(key('b'), '').action).toEqual({ type: 'screen', screen: 'black' });
    expect(onKey(key('B'), '').action).toEqual({ type: 'screen', screen: 'black' });
    expect(onKey(key('.'), '').action).toEqual({ type: 'screen', screen: 'black' });
    expect(onKey(key('w'), '').action).toEqual({ type: 'screen', screen: 'white' });
    expect(onKey(key(','), '').action).toEqual({ type: 'screen', screen: 'white' });
  });

  it('L and Ctrl+P switch the laser, and Ctrl+P is not left for the browser to print', () => {
    expect(type('l')).toBe('laser');
    expect(type('L')).toBe('laser');
    const p = onKey(key('p', { ctrlKey: true }), '');
    expect(p).toEqual({ handled: true, action: { type: 'laser' }, digits: '' });
  });

  it('F is full screen, and Esc leaves', () => {
    expect(type('f')).toBe('fullscreen');
    expect(type('Escape')).toBe('exit');
  });

  it('does not repeat a toggle while its key is held', () => {
    for (const k of ['b', 'w', 'l', 'f']) expect(onKey(key(k, { repeat: true }), '').action, k).toBeNull();
  });
});

describe('what the show leaves to the browser', () => {
  it('leaves Ctrl, Cmd and Alt chords alone, so reload, close and back still work', () => {
    for (const over of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(onKey(key('r', over), '')).toEqual({ handled: false, action: null, digits: '' });
      expect(onKey(key('ArrowLeft', over), '')).toEqual({ handled: false, action: null, digits: '' });
    }
  });

  it('leaves F11 and F12 and bare modifiers alone', () => {
    for (const k of ['F11', 'F12', 'Shift', 'Control', 'Alt', 'Meta']) expect(onKey(key(k), '').handled, k).toBe(false);
  });

  it('keeps every other key from the page under the show, so nothing is typed or deleted there', () => {
    for (const k of ['a', 'Delete', 'Tab', 'F5', 'x', '-', 'Insert']) {
      const out = onKey(key(k), '');
      expect(out.handled, k).toBe(true);
      expect(out.action, k).toBeNull();
    }
  });

  it('takes Ctrl+P with Shift held too, so a held Shift does not hand it to the browser', () => {
    expect(onKey(key('P', { ctrlKey: true, shiftKey: true }), '').action).toEqual({ type: 'laser' });
  });
});
