import { describe, expect, it } from 'vitest';
import { formatValue, general, isDateFormat } from '../format';
import { ERR, type Scalar } from '../values';

describe('General', () => {
  it.each([
    [0, '0'],
    [1234.5, '1234.5'],
    [-1234.5, '-1234.5'],
    [0.1 + 0.2, '0.3'],
    [1 / 3, '0.333333333'],
    [2 / 3, '0.666666667'],
    [123456789012, '1.23457E+11'],
    [12345678901, '12345678901'],
    [1e-10, '1E-10'],
    [0.0001234, '0.0001234'],
    [1e15, '1E+15'],
    [-0.5, '-0.5'],
    [100, '100']
  ])('%d shows as %s', (v, want) => {
    expect(general(v)).toBe(want);
  });
});

describe('number formats', () => {
  it.each<[string, Scalar, string]>([
    ['0.00', 3.14159, '3.14'],
    ['0', 2.5, '3'],
    ['00000', 123, '00123'],
    ['000-00-0000', 123456789, '123-45-6789'],
    ['#.##', 0.5, '.5'],
    ['0.###', 1.5, '1.5'],
    ['0.0??', 1.5, '1.5  '],
    ['#,##0', 1234567.8, '1,234,568'],
    ['#,##0.00', -1234.5, '-1,234.50'],
    ['#,##0,', 1234567, '1,235'],
    ['0.0,,"M"', 1234567, '1.2M'],
    ['0%', 0.256, '26%'],
    ['0.0%', 0.0125, '1.3%'],
    ['$#,##0.00', 1234.5, '$1,234.50'],
    ['$#,##0.00;($#,##0.00)', -1234.5, '($1,234.50)'],
    ['[$€-x-euro2] #,##0.00', 1234.5, '€ 1,234.50'],
    ['#,##0.00 "USD"', 1e6, '1,000,000.00 USD'],
    ['0" kg"', 5, '5 kg'],
    ['0_);(0)', 5, '5 '],
    ['0.00E+00', 12345, '1.23E+04'],
    ['0.00E+00', 0.00012345, '1.23E-04'],
    ['##0.0E+0', 12345, '12.3E+3'],
    ['# ?/?', 1.25, '1 1/4'],
    ['# ?/4', 1.5, '1 2/4'],
    ['?/?', 0.5, '1/2'],
    ['0;-0;"zero"', 0, 'zero'],
    ['0;(0)', -5, '(5)'],
    ['[>=100]"big";[<0]"neg";0', 150, 'big'],
    ['[>=100]"big";[>=10]"mid";0', 50, 'mid'],
    ['[>=100]"big";[<0]"neg";0', 5, '5'],
    ['General', 0.5, '0.5'],
    ['0.00', 'abc', 'abc'],
    ['@', 'abc', 'abc'],
    ['"Name: "@', 'Bob', 'Name: Bob'],
    ['0;-0;0;"t:"@', 'x', 't:x'],
    ['0.00', true, 'TRUE'],
    ['0.00', null, '']
  ])('%s on %j is %s', (code, v, want) => {
    expect(formatValue(v, code).text).toBe(want);
  });

  it('shows errors as their code', () => {
    expect(formatValue(ERR.na, '0.00').text).toBe('#N/A');
  });

  it('colours a section', () => {
    expect(formatValue(-5, '[Red]0;[Blue]-0')).toEqual({ text: '-5', color: '#0000FF' });
    expect(formatValue(5, '[Red]0;[Blue]-0')).toEqual({ text: '5', color: '#FF0000' });
    expect(formatValue(5, '[Color10]0').color).toBe('#008000');
  });

  it('marks a fill for the renderer', () => {
    expect(formatValue(5, '*-0')).toEqual({ text: '5', fill: { char: '-', at: 0 } });
    expect(formatValue(5, '$* 0')).toEqual({ text: '$5', fill: { char: ' ', at: 1 } });
  });
});

describe('date and time formats', () => {
  it.each<[string, number, string]>([
    ['yyyy-mm-dd', 45306, '2024-01-15'],
    ['d mmm yyyy', 45306, '15 Jan 2024'],
    ['dddd', 45306, 'Monday'],
    ['ddd d/m/yy', 45306, 'Mon 15/1/24'],
    ['mmmm', 45306, 'January'],
    ['mmmmm', 45306, 'J'],
    ['m/d/yy', 60, '2/29/00'],
    ['h:mm', 0.75, '18:00'],
    ['h:mm AM/PM', 0.75, '6:00 PM'],
    ['h:mm a/p', 0.25, '6:00 a'],
    ['hh:mm:ss', 0.5 + 1 / 86400, '12:00:01'],
    ['[h]:mm', 1.5, '36:00'],
    ['[mm]:ss', 1 / 24, '60:00'],
    ['mm:ss.0', 1.5 / 86400, '00:01.5'],
    ['dd/mm/yyyy hh:mm', 45306.5, '15/01/2024 12:00'],
    ['h:mm:ss', 0.99999999, '0:00:00'],
    ['yyyy', -1, '##########']
  ])('%s on %d is %s', (code, v, want) => {
    expect(formatValue(v, code).text).toBe(want);
  });

  it('knows a date format from a number format', () => {
    expect(isDateFormat('dd/mm/yyyy')).toBe(true);
    expect(isDateFormat('h:mm')).toBe(true);
    expect(isDateFormat('0.00')).toBe(false);
    expect(isDateFormat(undefined)).toBe(false);
  });
});
