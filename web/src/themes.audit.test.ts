import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The surfaces that were audited for both themes (Phase 5b), held where they are.
 *
 * A surface that wears a literal colour ignores the theme. What is left in these files is on purpose:
 * a document's own colours (a chart's card, a slide's stand-in, the page's white), a colour that sits
 * on a colour the person chose (a name on a cursor), the dots that preview a page colour, or print.
 * Each count below is what is left. A new literal `color`, `background`, `fill`, `border` … that is not
 * a `var(--token)` and is not in a theme-scoped rule (`[data-theme='dark']`) pushes a file over its
 * count: use a token, or a rule for the dark theme, or (if it really is the document's) raise the count
 * and say why in the commit.
 *
 * Counted: declarations in rules that are not under `@media print` and not scoped to a theme, whose value
 * has a hex or `rgb()` in it and no `var()`. Fallbacks inside a `var(--x, #fff)` are not literals.
 */

const ALLOWED: Record<string, number> = {
  // A pill on amber and its warning text; their dark twins are theme-scoped.
  'core/share.css': 3,
  // The title field's focus wash (its dark twin is theme-scoped), the print ground is excluded.
  'core/shell/shell.css': 2,
  // Find's match colours, per page colour, and the page's own pre block.
  'docs/core/core.css': 4,
  // The page colour's preview dots, and a code block that is dark on every page.
  'docs/doc.css': 5,
  // The star on a card and the drop target, each with a dark twin; the kind mark's white glyph.
  'home/home.css': 3,
  // A chart is a drawn object with its own white surface and ink, like a picture.
  'sheets/charts/charts.css': 8,
  // The fill handle's ring, a person's label, and the disabled ink.
  'sheets/grid/grid.css': 5,
  // The slide's own text box, the handles on a slide, the marquee, and a name on a person's colour.
  'slides/editor/editor.css': 6,
  'slides/modules/insert/insert.css': 1,
  'slides/panes/format/format.css': 1,
  // The slide show and the presenter's view are dark whatever the choice.
  'slides/present/present.css': 19,
  // A slide's own stand-ins and default ink.
  'slides/render/render.css': 4,
  // White on danger, the switch's thumb, a name on a colour, the tints of a notice, and the glass.
  'styles.css': 11
};

interface Rule {
  selector: string;
  body: string;
  media: string | null;
}

function parse(css: string): Rule[] {
  const out: Rule[] = [];
  const walk = (src: string, media: string | null) => {
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
      if (head.startsWith('@media')) walk(inner, head);
      else if (!head.startsWith('@')) out.push({ selector: head.replace(/\s+/g, ' '), body: inner, media });
      i = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), null);
  return out;
}

const LITERAL = /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\))/;
const PROPERTY = /(^|[;\s])((?:background(?:-color)?|color|fill|stroke|border(?:-[a-z]+)?-color|border|outline|caret-color|accent-color))\s*:\s*([^;]+)/g;

function literals(css: string): string[] {
  const found: string[] = [];
  for (const r of parse(css)) {
    if (/data-theme=.(dark|light)/.test(r.selector) || r.media === '@media print') continue;
    for (const m of r.body.matchAll(PROPERTY)) {
      if (LITERAL.test(m[3]!) && !/var\(/.test(m[3]!)) found.push(`${r.selector} { ${m[2]}: ${m[3]!.trim()} }`);
    }
  }
  return found;
}

const root = join(process.cwd(), 'web/src');
function cssFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== 'harness' && f !== 'node_modules') cssFiles(p, out);
    } else if (p.endsWith('.css')) out.push(p.slice(root.length + 1));
  }
  return out;
}

describe('literal colours in the audited surfaces', () => {
  for (const [file, allowed] of Object.entries(ALLOWED)) {
    it(`${file} has no more than the ${allowed} that are meant`, () => {
      const found = literals(readFileSync(join(root, file), 'utf8'));
      expect(found.length, found.join('\n')).toBeLessThanOrEqual(allowed);
    });
  }

  it('lists a file that has a literal colour of its own, or is not one of the audited', () => {
    // Every file with a literal that is not here is a file that was not looked at, or a new one.
    const known = new Set(Object.keys(ALLOWED));
    const unaudited = cssFiles(root)
      .filter((f) => !known.has(f) && literals(readFileSync(join(root, f), 'utf8')).length > 0)
      // Another part's own file; its owner decides.
      .filter((f) => !/carets/.test(f) && !/ContextMenu|contextMenu|popup|Select|listbox/i.test(f));
    expect(unaudited).toEqual([]);
  });

  it('makes the dark theme’s hairlines the theme’s, not an ink of the light one', () => {
    // 0.04 to 0.07 of rgb(40, 28, 45) is the light theme's hairline and is invisible on the dark one.
    const styles = readFileSync(join(root, 'styles.css'), 'utf8');
    expect(styles).toMatch(/\[data-theme='dark'\] \.oa-thread \{\s*box-shadow: 0 0 0 1px var\(--bd-soft\)/);
  });
});
