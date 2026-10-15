import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The converters run in a Web Worker, and in a server-side exporter: neither has a
 * page. This reads their source for the things only a page has. `browser/` is the one folder
 * that is allowed them, and `testing.ts` and the tests are not shipped.
 */

const DIR = dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'browser' ? [] : sources(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && name !== 'testing.ts' ? [path] : [];
  });
}

/** Source with comments and string contents blanked out, so prose and examples do not count. */
const code = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\[\s\S])*`/g, '""');

const FORBIDDEN: [RegExp, string][] = [
  [/\bdocument\./, 'document'],
  [/\bwindow\b/, 'window'],
  [/\bDOMParser\b/, 'DOMParser'],
  [/\b(?:localStorage|sessionStorage|indexedDB)\b/, 'browser storage'],
  [/\bnavigator\b/, 'navigator'],
  [/\blocation\b/, 'location'],
  [/\bnew Worker\b/, 'a worker'],
  [/\bfetch\s*\(/, 'fetch'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bimport\.meta\b/, 'import.meta'],
  [/from '\.\.\/\.\.\/(?:core|home|pages)\//, 'a screen']
];

describe('the converters', () => {
  const files = sources(DIR);

  it('are a good many files, so the scan is of the right folder', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  for (const file of files) {
    it(`${relative(DIR, file)} uses nothing only a page has`, () => {
      const text = code(readFileSync(file, 'utf8'));
      for (const [pattern, what] of FORBIDDEN) expect(pattern.test(text), `uses ${what}`).toBe(false);
    });
  }
});
