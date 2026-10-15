import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { baseName, classify, KINDS } from './kinds';

describe('the kinds', () => {
  it('say what the shell says', () => {
    const shell = JSON.parse(readFileSync(fileURLToPath(new URL('../../../shell/officeapps/kinds.json', import.meta.url)), 'utf8')) as Record<string, unknown>;
    const ours = Object.fromEntries(Object.entries(KINDS).map(([k, { kind: _k, ...rest }]) => [k, rest]));
    expect(ours).toEqual(shell);
  });

  it('classify a file by its name', () => {
    expect(classify('/x/Plan.oadoc')).toEqual({ kind: 'docs', native: true });
    expect(classify('notes.MD')).toEqual({ kind: 'docs', native: false });
    expect(classify('book.xlsx')).toEqual({ kind: 'sheets', native: false });
    expect(classify('deck.pptx')).toBeNull();
    expect(baseName('/a/b/Q3 plan.oasheet')).toBe('Q3 plan');
    expect(baseName('.oadoc')).toBe('.oadoc');
  });
});
