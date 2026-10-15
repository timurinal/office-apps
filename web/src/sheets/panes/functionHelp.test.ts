import { describe, expect, it } from 'vitest';
import { OWN_FUNCTIONS, isKnownFunction } from '../engine';
import { CATEGORY_ORDER, FUNCTION_HELP } from './functionHelp';

describe('the function help', () => {
  it('is only for functions the engine has', () => {
    for (const name of FUNCTION_HELP.keys()) expect(isKnownFunction(name), name).toBe(true);
  });

  it('says what each function does, in a sentence, and what each argument is', () => {
    for (const f of FUNCTION_HELP.values()) {
      expect(f.text, f.name).toMatch(/^[A-Z].*\.$/);
      for (const a of f.args) expect(a.text, `${f.name}(${a.name})`).not.toBe('');
      expect(f.signature.startsWith(`${f.name}(`), f.name).toBe(true);
      expect(CATEGORY_ORDER).toContain(f.category);
    }
  });

  it('writes the signature from the arguments, optional ones in brackets', () => {
    expect(FUNCTION_HELP.get('SUM')!.signature).toBe('SUM(number1, [number2], …)');
    expect(FUNCTION_HELP.get('IF')!.args.map((a) => [a.name, a.optional])).toEqual([
      ['logical_test', false],
      ['value_if_true', false],
      ['value_if_false', true]
    ]);
    expect(FUNCTION_HELP.get('PI')!.signature).toBe('PI()');
    expect(FUNCTION_HELP.get('PI')!.args).toEqual([]);
  });

  it('covers nearly every function of the engine’s own', () => {
    const missing = OWN_FUNCTIONS.filter((n) => !FUNCTION_HELP.has(n));
    // The few that are left are variants of one that has help.
    expect(missing, missing.join(' ')).toEqual([]);
  });
});
