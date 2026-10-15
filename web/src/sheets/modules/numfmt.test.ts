import { describe, expect, it } from 'vitest';
import { formatValue } from '../engine';
import { FORMATS, accountingCode, categoryOf, currencyCode, currencyOf, decimalsOf, hasThousands, stepDecimals } from './numfmt';

const show = (v: number, code: string) => formatValue(v, code).text;

describe('currency codes', () => {
  it('quote the symbol, except the dollar, which the engine reads as it is', () => {
    expect(currencyCode('£')).toBe('"£"#,##0.00');
    expect(currencyCode('$')).toBe('$#,##0.00');
    expect(currencyCode('€', 0)).toBe('"€"#,##0');
  });

  it('draw what a person expects', () => {
    expect(show(1234.5, currencyCode('£'))).toBe('£1,234.50');
    expect(show(-1234.5, currencyCode('$'))).toBe('-$1,234.50');
    expect(show(1234.5, currencyCode('€'))).toBe('€1,234.50');
    expect(show(-1234.5, accountingCode('£'))).toBe('(£1,234.50)');
  });

  it('say which symbol a code shows', () => {
    expect(currencyOf(currencyCode('€'))).toBe('€');
    expect(currencyOf(currencyCode('$'))).toBe('$');
    expect(currencyOf('0.00')).toBeNull();
  });
});

describe('the categories', () => {
  it('recognise the code each one applies', () => {
    for (const f of FORMATS) expect(categoryOf(f.code('£')), f.label).toBe(f.id);
  });

  it('read Excel codes people bring', () => {
    expect(categoryOf(undefined)).toBe('general');
    expect(categoryOf('General')).toBe('general');
    expect(categoryOf('0')).toBe('number');
    expect(categoryOf('#,##0.0')).toBe('number');
    expect(categoryOf('0%')).toBe('percent');
    expect(categoryOf('d mmm yyyy')).toBe('date-short');
    expect(categoryOf('h:mm AM/PM')).toBe('time');
    expect(categoryOf('mm:ss')).toBe('time');
    expect(categoryOf('"£"#,##0;[Red]-"£"#,##0')).toBe('currency');
    expect(categoryOf('#,##0.00 [$€-x-euro2]')).toBe('currency');
    expect(categoryOf('0.00" kg"')).toBe('number');
    expect(categoryOf('"Q"0')).toBe('number');
  });

  it('does not take a word in quotes for a symbol', () => {
    expect(categoryOf('0.0" per %"')).toBe('number');
    expect(categoryOf('0" days"')).toBe('number');
  });

  it('knows a thousands separator', () => {
    expect(hasThousands('#,##0.00')).toBe(true);
    expect(hasThousands('0.00')).toBe(false);
    expect(hasThousands(undefined)).toBe(false);
  });
});

describe('more and fewer decimals', () => {
  it('start General at one place and leave it General going down', () => {
    expect(stepDecimals(undefined, 1)).toBe('0.0');
    expect(stepDecimals('General', 1)).toBe('0.0');
    expect(stepDecimals('General', -1)).toBe('General');
  });

  it('add a place after the last digit, or after the point', () => {
    expect(stepDecimals('0', 1)).toBe('0.0');
    expect(stepDecimals('#,##0', 1)).toBe('#,##0.0');
    expect(stepDecimals('0.00', 1)).toBe('0.000');
    expect(stepDecimals('0%', 1)).toBe('0.0%');
    expect(stepDecimals('0.00E+00', 1)).toBe('0.000E+00');
    expect(stepDecimals(currencyCode('£'), 1)).toBe('"£"#,##0.000');
  });

  it('remove one, and the point with the last', () => {
    expect(stepDecimals('0.00', -1)).toBe('0.0');
    expect(stepDecimals('0.0', -1)).toBe('0');
    expect(stepDecimals('0', -1)).toBe('0');
    expect(stepDecimals('#,##0.00', -1)).toBe('#,##0.0');
    expect(stepDecimals('0.00%', -1)).toBe('0.0%');
  });

  it('change every section, and leave the text between them alone', () => {
    expect(stepDecimals('0.00;[Red]-0.00', -1)).toBe('0.0;[Red]-0.0');
    expect(stepDecimals(accountingCode('£'), 1)).toBe('"£"#,##0.000_);("£"#,##0.000)');
    expect(stepDecimals('0.00" per 100.5"', -1)).toBe('0.0" per 100.5"');
  });

  it('do nothing to what has no decimals to change', () => {
    expect(stepDecimals('dd/mm/yyyy', 1)).toBe('dd/mm/yyyy');
    expect(stepDecimals('@', 1)).toBe('@');
    expect(stepDecimals('# ?/?', -1)).toBe('# ?/?');
  });

  it('show it as the cell does', () => {
    expect(show(1234.5678, stepDecimals('0.00', 1))).toBe('1234.568');
    expect(show(1234.5678, stepDecimals('0.00', -1))).toBe('1234.6');
    expect(decimalsOf('#,##0.000')).toBe(3);
    expect(decimalsOf('0')).toBe(0);
    expect(decimalsOf('General')).toBeNull();
  });
});
