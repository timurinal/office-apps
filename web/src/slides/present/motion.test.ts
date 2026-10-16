import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The motion rule, held on the files themselves: only transform and opacity animate, and a wipe is
 * a mask that moves, never a clip-path. Reduced motion is held by `transitions.test.ts` and
 * `Stage.test.tsx` for what script plays, and by the last test here for the gallery's CSS.
 */

const here = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const css = here('present.css');

const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ALLOWED = new Set(['opacity', 'transform']);

describe('what the slide show’s CSS animates', () => {
  it('has keyframes that set only transform and opacity', () => {
    const blocks = [...noComments(css).matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)];
    expect(blocks.length).toBeGreaterThan(0);
    for (const [, name, body] of blocks) {
      const props = [...body!.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]!);
      expect(props.length, name).toBeGreaterThan(0);
      for (const p of props) expect(ALLOWED.has(p), `${name}: ${p}`).toBe(true);
    }
  });

  it('transitions only transform and opacity', () => {
    for (const m of noComments(css).matchAll(/transition(?:-property)?\s*:\s*([^;]+);/g)) {
      const first = m[1]!.trim().split(/[\s,]+/)[0]!;
      expect(ALLOWED.has(first), m[0]).toBe(true);
    }
  });

  it('never uses a clip-path, here or where a wipe is made', () => {
    for (const f of ['present.css', 'Stage.tsx', 'transitions.ts', 'Surface.tsx', 'PreviewLayer.tsx']) {
      expect(noComments(here(f)).toLowerCase(), f).not.toMatch(/clip-?path/);
    }
  });

  it('leaves the gallery’s tiles as fades under reduced motion, in the media query and in data-motion="off"', () => {
    const body = noComments(css);
    const media = body.slice(body.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(media).toContain('animation: none !important');
    expect(media).toContain('sp-t-fade');
    expect(body).toContain(":root[data-motion='off'] .sp-opt");
    // The moving kinds are not left running under it: every kind's animation is overridden to a fade.
    expect(body).toMatch(/:root\[data-motion='off'\] \.sp-opt:hover:not\(:disabled\) \.sp-tile\[data-kind\]:not\(\[data-kind='none'\]\) \.b/);
  });
});
