import { describe, expect, it } from 'vitest';
import { dateToSerial, parseDateTime, serialToDate, weekday } from '../dates';
import { parseValue } from '../input';
import { numberToText, parseNumber } from '../values';

describe('the 1900 date system', () => {
  it('counts the 29 February 1900 that never was', () => {
    expect(dateToSerial(1900, 1, 1)).toBe(1);
    expect(dateToSerial(1900, 2, 28)).toBe(59);
    expect(dateToSerial(1900, 2, 29)).toBe(60);
    expect(dateToSerial(1900, 3, 1)).toBe(61);
    expect(serialToDate(60)).toEqual({ y: 1900, m: 2, d: 29 });
    expect(serialToDate(59)).toEqual({ y: 1900, m: 2, d: 28 });
    expect(serialToDate(61)).toEqual({ y: 1900, m: 3, d: 1 });
    expect(serialToDate(0)).toEqual({ y: 1900, m: 1, d: 0 });
  });

  it('agrees with the real calendar after it', () => {
    expect(dateToSerial(2024, 1, 15)).toBe(45306);
    expect(serialToDate(45306)).toEqual({ y: 2024, m: 1, d: 15 });
    expect(dateToSerial(9999, 12, 31)).toBe(2958465);
    expect(Number.isNaN(dateToSerial(10000, 1, 1))).toBe(true);
    expect(weekday(45306)).toBe(2); // Monday
    expect(weekday(1)).toBe(1); // Excel's Sunday
  });

  it('round-trips every day of a leap year and its neighbours', () => {
    for (let s = dateToSerial(2023, 1, 1); s <= dateToSerial(2025, 12, 31); s++) {
      const { y, m, d } = serialToDate(s);
      expect(dateToSerial(y, m, d)).toBe(s);
    }
  });

  it('reads typed dates and times in the workbook order', () => {
    expect(parseDateTime('15/01/2024', 'dmy')).toEqual({ serial: 45306, format: 'dd/mm/yyyy' });
    expect(parseDateTime('01/15/2024', 'mdy')).toEqual({ serial: 45306, format: 'mm/dd/yyyy' });
    expect(parseDateTime('01/15/2024', 'dmy')).toBeUndefined();
    expect(parseDateTime('2024-01-15')?.serial).toBe(45306);
    expect(parseDateTime('Jan 15, 2024')?.serial).toBe(45306);
    expect(parseDateTime('18:30')).toEqual({ serial: 18.5 / 24, format: 'h:mm' });
    expect(parseDateTime('6:30 PM')?.serial).toBe(18.5 / 24);
    expect(parseDateTime('2024-01-15 12:00')?.serial).toBe(45306.5);
    expect(parseDateTime('31/02/2024')).toBeUndefined();
  });
});

describe('numbers as text', () => {
  it('reads what Excel reads', () => {
    expect(parseNumber(' 5 ')).toBe(5);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('12%')).toBe(0.12);
    expect(parseNumber('$5')).toBe(5);
    expect(parseNumber('-$5')).toBe(-5);
    expect(parseNumber('(5)')).toBe(-5);
    expect(parseNumber('1e3')).toBe(1000);
    expect(parseNumber('1,23')).toBeUndefined();
    expect(parseNumber('abc')).toBeUndefined();
  });

  it('writes 15 significant digits', () => {
    expect(numberToText(0.1 + 0.2)).toBe('0.3');
    expect(numberToText(1 / 3)).toBe('0.333333333333333');
    expect(numberToText(1e21)).toBe('1E+21');
    expect(numberToText(-1.5e-7)).toBe('-1.5E-07');
    expect(numberToText(123456789012345680)).toBe('1.23456789012346E+17');
  });
});

describe('typed input', () => {
  it.each([
    ['', null, undefined],
    ['42', { v: 42 }, undefined],
    ['-3.5', { v: -3.5 }, undefined],
    ['12%', { v: 0.12 }, '0%'],
    ['12.5%', { v: 0.125 }, '0.0%'],
    ['$1,234.50', { v: 1234.5 }, '$#,##0.00'],
    ['€5', { v: 5 }, '"€"#,##0'],
    ['1,234', { v: 1234 }, '#,##0'],
    ['1e5', { v: 100000 }, '0.00E+00'],
    ['(5)', { v: -5 }, undefined],
    ['true', { v: true }, undefined],
    ['FALSE', { v: false }, undefined],
    ['#n/a', { e: '#N/A' }, undefined],
    ["'42", { v: '42' }, undefined],
    ['15/01/2024', { v: 45306 }, 'dd/mm/yyyy'],
    ['9:30', { v: 9.5 / 24 }, 'h:mm'],
    ['hello', { v: 'hello' }, undefined],
    ['  padded ', { v: '  padded ' }, undefined],
    ['=', { v: '=' }, undefined]
  ])('%j', (text, content, format) => {
    const r = parseValue(text, 'dmy');
    expect(r.content).toEqual(content);
    expect(r.format).toBe(format);
  });
});
