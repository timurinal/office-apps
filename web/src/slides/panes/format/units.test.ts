import { describe, expect, it } from 'vitest';
import { cmToPx, formatCm, formatDegrees, formatPercent, formatPt, parseDegrees, parseLength, parsePercent, parsePoints, parsePt, pxToCm, PX_PER_CM, SLIDE_CM } from './units';

describe('lengths', () => {
  it('a slide is 33.867 cm across and 1 cm is 1920 / 33.867 px', () => {
    expect(PX_PER_CM).toBeCloseTo(56.69, 2);
    expect(cmToPx(SLIDE_CM)).toBeCloseTo(1920, 6);
    expect(pxToCm(1920)).toBeCloseTo(33.867, 6);
  });

  it('shows centimetres to two places, as the board does', () => {
    expect(formatCm(cmToPx(8.76))).toBe('8.76 cm');
    expect(formatCm(cmToPx(16.26))).toBe('16.26 cm');
    expect(formatCm(0)).toBe('0.00 cm');
  });

  it('reads what a person types, in any unit, with a comma or a point', () => {
    expect(parseLength('8.76')).toBeCloseTo(cmToPx(8.76), 6);
    expect(parseLength('8,76 cm')).toBeCloseTo(cmToPx(8.76), 6);
    expect(parseLength('25 mm')).toBeCloseTo(cmToPx(2.5), 6);
    expect(parseLength('3 in')).toBeCloseTo(cmToPx(7.62), 6);
    expect(parseLength('3"')).toBeCloseTo(cmToPx(7.62), 6);
    expect(parseLength('12 pt')).toBe(24);
    expect(parseLength('100px')).toBe(100);
    expect(parseLength('-2')).toBeCloseTo(cmToPx(-2), 6);
    expect(parseLength('.5')).toBeCloseTo(cmToPx(0.5), 6);
  });

  it('refuses what is not a length', () => {
    for (const bad of ['', 'abc', '2 parsecs', '1..2', '--3', '1 2']) expect(parseLength(bad), bad).toBeNull();
  });

  it('round-trips what it shows', () => {
    for (const px of [0, 1, 123.4, 496.6, 1920]) expect(parseLength(formatCm(px))!).toBeCloseTo(px, 0);
  });
});

describe('rotation', () => {
  it('shows degrees without trailing zeros and takes any angle into 0 up to 360', () => {
    expect(formatDegrees(0)).toBe('0°');
    expect(formatDegrees(45.5)).toBe('45.5°');
    expect(parseDegrees('45°')).toBe(45);
    expect(parseDegrees('-90')).toBe(270);
    expect(parseDegrees('370')).toBe(10);
    expect(parseDegrees('360')).toBe(0);
    expect(parseDegrees('x')).toBeNull();
  });
});

describe('points and per cent', () => {
  it('a line width is stored in px and shown in points', () => {
    expect(formatPt(2)).toBe('1 pt');
    expect(formatPt(3)).toBe('1.5 pt');
    expect(parsePt('1.5 pt')).toBe(3);
    expect(parsePt('0.75')).toBe(1.5);
    expect(parsePoints('18 pt')).toBe(18);
    expect(parsePoints('abc')).toBeNull();
  });

  it('a fraction is a per cent', () => {
    expect(formatPercent(0.25)).toBe('25%');
    expect(parsePercent('40%')).toBe(0.4);
    expect(parsePercent('7')).toBe(0.07);
    expect(parsePercent('lots')).toBeNull();
  });
});
