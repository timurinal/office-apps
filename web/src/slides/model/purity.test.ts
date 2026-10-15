import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The deck model and the shape geometry run where there is no page: a Web Worker converting a
 * pptx, and the Worker when the assistant reads or writes a deck. This reads their source for what only a
 * page has. `themes/purity.test.ts` does the same for the themes and templates.
 */

const SLIDES = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  ...readdirSync(join(SLIDES, 'model'))
    .filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && name !== 'testing.ts')
    .map((name) => join(SLIDES, 'model', name)),
  join(SLIDES, 'render', 'geometry.ts')
];

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
  [/\brequestAnimationFrame\b/, 'a frame'],
  [/from 'react/, 'React'],
  [/from '@tiptap\/react/, 'a Tiptap view'],
  [/from 'prosemirror-view'/, 'a ProseMirror view'],
  [/from '\.\.\/\.\.\/(?:core|home|pages|docs|sheets)\//, 'a screen']
];

describe('the slide model', () => {
  it('is the files it should be', () => {
    expect(FILES.length).toBeGreaterThan(8);
  });

  for (const file of FILES) {
    it(`${relative(SLIDES, file)} uses nothing only a page has`, () => {
      const text = code(readFileSync(file, 'utf8'));
      for (const [pattern, what] of FORBIDDEN) expect(pattern.test(text), `uses ${what}`).toBe(false);
    });
  }
});
