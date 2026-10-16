import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOOTER_STEPS, HEADER_STEPS } from './squeeze';

/**
 * The header and the footer short of room are CSS: squeeze.ts only says which steps are taken. What
 * keeps them from drawing one thing over another is read from the stylesheet here.
 */

interface Rule {
  selector: string;
  body: string;
}

function parse(css: string): Rule[] {
  const out: Rule[] = [];
  const walk = (src: string) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (depth > 0 && j < src.length) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      const inner = src.slice(open + 1, j - 1);
      if (head.startsWith('@media') || head.startsWith('@supports')) walk(inner);
      else if (!head.startsWith('@')) out.push({ selector: head.replace(/\s+/g, ' '), body: inner });
      i = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  return out;
}

const read = (p: string) => parse(readFileSync(join(process.cwd(), 'web', p), 'utf8'));
const shell = read('src/core/shell/shell.css');
const styles = read('src/styles.css');

const decl = (rule: Rule | undefined, name: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+)`).exec(rule?.body ?? '')?.[1]?.trim();
const exactly = (rules: Rule[], selector: string) => rules.find((r) => r.selector === selector);
const naming = (bar: string, step: string) => shell.filter((r) => r.selector.includes(`${bar}[data-squeeze~='${step}']`));

describe('the shell', () => {
  it('clips rather than hides, so nothing focused past its edge can scroll the editor aside', () => {
    expect(decl(exactly(shell, '.oa-shell'), 'overflow')).toBe('clip');
  });
});

describe('the header and the footer, short of room', () => {
  it('has a rule for every step squeeze.ts can take, and no step it cannot', () => {
    for (const step of HEADER_STEPS) expect(naming('.oa-hd', step), `.oa-hd ${step}`).not.toHaveLength(0);
    for (const step of FOOTER_STEPS) expect(naming('.oa-footer', step), `.oa-footer ${step}`).not.toHaveLength(0);
    const named = shell.flatMap((r) => [...r.selector.matchAll(/(\.oa-hd|\.oa-footer)\[data-squeeze~='([\w-]+)'\]/g)].map((m) => `${m[1]} ${m[2]}`));
    const known = [...HEADER_STEPS.map((s) => `.oa-hd ${s}`), ...FOOTER_STEPS.map((s) => `.oa-footer ${s}`)];
    expect(named.filter((n) => !known.includes(n))).toEqual([]);
  });

  it('ends the title in an ellipsis, in the field and in the heading', () => {
    expect(decl(exactly(shell, '.oa-hd-title-input'), 'text-overflow')).toBe('ellipsis');
    expect(decl(exactly(styles, '.oa-ellipsis'), 'text-overflow')).toBe('ellipsis');
    // The title's half may be narrower than what it holds; the title is what gives.
    expect(decl(exactly(shell, '.oa-hd-left'), 'min-width')).toBe('0');
    expect(decl(exactly(shell, '.oa-hd-titlewrap'), 'min-width')).toMatch(/^\d+px$/);
  });

  it('never lets the right of the header, or the zoom, shrink under what they hold', () => {
    expect(decl(exactly(shell, '.oa-hd-right'), 'min-width')).toBeUndefined();
    expect(decl(exactly(shell, '.oa-zoom'), 'min-width')).toBeUndefined();
    expect(decl(exactly(shell, '.oa-zoom'), 'flex')).toBe('none');
  });

  it('drops words by making them take no room, so a button keeps its name', () => {
    for (const bar of ['.oa-hd', '.oa-footer']) {
      const words = naming(bar, 'words');
      expect(words.some((r) => decl(r, 'font-size') === '0'), bar).toBe(true);
      expect(words.every((r) => decl(r, 'display') !== 'none'), bar).toBe(true);
    }
    // The comment count keeps its own size inside a button without words.
    expect(decl(exactly(shell, '.oa-count'), 'font-size')).toBe('10px');
  });
});
