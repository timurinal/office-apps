import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Themes and templates are data, and they are built in a Web Worker (a pptx written from a template)
 * and in the Worker (the assistant making a deck) as readily as on a page. This reads their source for what
 * only a page has, and for the two things that would make a deck different each time it is built:
 * the clock and a random number. `formats/purity.test.ts` does the same for the converters.
 */

const SLIDES = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = [join(SLIDES, 'themes'), join(SLIDES, 'templates')];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
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
  [/\b(?:localStorage|sessionStorage|indexedDB)\b/, 'browser storage'],
  [/\bnavigator\b/, 'navigator'],
  [/\blocation\b/, 'location'],
  [/\bfetch\s*\(/, 'fetch'],
  [/\bimport\.meta\b/, 'import.meta'],
  [/\bMath\.random\b/, 'a random number'],
  [/\bDate\b/, 'the clock'],
  [/\bcrypto\b/, 'crypto'],
  [/from 'react/, 'React'],
  [/from 'yjs'/, 'Yjs'],
  [/from '@tiptap/, 'Tiptap'],
  [/from '\.\.\/\.\.\/(?:core|home|pages)\//, 'a screen'],
  [/from '\.\.\/\.\.\/docs\/(?!core\/fonts)/, 'Docs']
];

describe('themes and templates', () => {
  const files = DIRS.flatMap(sources);

  it('are a good many files, so the scan is of the right folders', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`${relative(SLIDES, file)} uses nothing only a page has, and nothing that varies`, () => {
      const text = code(readFileSync(file, 'utf8'));
      for (const [pattern, what] of FORBIDDEN) expect(pattern.test(text), `uses ${what}`).toBe(false);
    });
  }
});
