import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { exactCase } from '../vite.exact-case';

const core = fileURLToPath(new URL('../web/src/docs/core/', import.meta.url));
const resolveId = exactCase().resolveId as (source: string, importer?: string) => string | null;

describe('relative imports by their exact case', () => {
  it('tells Picker.tsx from picker.ts, on any disk', () => {
    expect(resolveId('./Picker', `${core}Host.tsx`)).toBe(`${core}Picker.tsx`);
    expect(resolveId('./picker', `${core}Picker.tsx`)).toBe(`${core}picker.ts`);
    expect(resolveId('./picker', `${core}chips.ts?worker`)).toBe(`${core}picker.ts`);
  });

  it('leaves everything else to Vite', () => {
    expect(resolveId('react', `${core}Host.tsx`)).toBeNull();
    expect(resolveId('./grid.css', `${core}Host.tsx`)).toBeNull();
    expect(resolveId('./icon.svg?raw', `${core}Host.tsx`)).toBeNull();
    expect(resolveId('../modules', `${core}Host.tsx`)).toBeNull();
    expect(resolveId('./Picker', undefined)).toBeNull();
    expect(resolveId('./nothing-here', `${core}Host.tsx`)).toBeNull();
  });
});
