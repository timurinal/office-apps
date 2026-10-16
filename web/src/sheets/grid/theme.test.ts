// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { FALLBACK_THEME, readTheme } from './theme';

describe('readTheme', () => {
  it('reads the colours from the grid’s custom properties and falls back for the ones it is not given', () => {
    const el = document.createElement('div');
    el.style.setProperty('--sg-paper', '#232532');
    el.style.setProperty('--sg-ink', '#e9e9ed');
    document.body.appendChild(el);
    const t = readTheme(el);
    expect(t.paper).toBe('#232532');
    expect(t.ink).toBe('#e9e9ed');
    expect(t.line).toBe(FALLBACK_THEME.line);
    el.remove();
  });

  it('is Dark cells only when the stylesheet says so for this theme', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(readTheme(el).darkCells).toBe(false);
    el.style.setProperty('--sg-dark-cells', '1');
    expect(readTheme(el).darkCells).toBe(true);
    el.style.setProperty('--sg-dark-cells', '0');
    expect(readTheme(el).darkCells).toBe(false);
    el.remove();
  });
});
