/**
 * Breaks as widget decorations: the only thing the page view puts into the body's DOM.
 *
 *   block    an empty block before the unit that starts the next page: a `<div>`, or an
 *            `<li>` inside a list so the list's own spacing rules still see an item there
 *   inline   an empty `display: block` span at the first character of the line that starts
 *            the next page, inside the paragraph
 *   row      an empty `<tr>` before the row, then copies of the table's header rows
 *   part     nothing here: the atom draws it inside its own DOM (nodes.ts, TocView), since a
 *            widget cannot go inside an atom
 *
 * A spacer that crosses from one sheet to the next includes the desk between them, as
 * `var(--pg-gap)`, so print can take the desk out (pagination.css) and the printed pages
 * fall exactly where the screen's do.
 */

import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Break } from './layout';
import { isList } from './measure';

export const heightCss = (b: Break, gap: number): string =>
  b.crosses ? `calc(${(b.height - gap).toFixed(2)}px + var(--pg-gap, ${gap}px))` : `${b.height.toFixed(2)}px`;

function spacer(tag: string, cls: string, height: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  el.style.height = height;
  el.setAttribute('aria-hidden', 'true');
  el.contentEditable = 'false';
  return el;
}

export function buildDecorations(doc: PMNode, breaks: readonly Break[], gap: number): DecorationSet {
  const decos: Decoration[] = [];
  for (const b of breaks) {
    if (b.kind === 'part') continue;
    const h = heightCss(b, gap);
    if (b.kind === 'block') {
      const parent = doc.resolve(Math.min(b.pos, doc.content.size)).parent;
      const tag = isList(parent) ? 'li' : 'div';
      decos.push(Decoration.widget(b.pos, () => spacer(tag, 'pg-sp pg-sp-block', h), { side: -20, key: `b${tag}${h}`, ignoreSelection: true }));
    } else if (b.kind === 'inline') {
      decos.push(Decoration.widget(b.pos, () => spacer('span', 'pg-sp pg-sp-inline', h), { side: -20, key: `i${h}`, ignoreSelection: true }));
    } else {
      const cols = b.cols ?? 1;
      decos.push(
        Decoration.widget(
          b.pos,
          () => {
            const tr = document.createElement('tr');
            tr.className = 'pg-sp pg-sp-row';
            tr.setAttribute('aria-hidden', 'true');
            const td = document.createElement('td');
            td.colSpan = cols;
            td.style.height = h;
            tr.appendChild(td);
            return tr;
          },
          { side: -20, key: `r${h}:${cols}`, ignoreSelection: true }
        )
      );
      if (b.repeatHeader && b.tablePos !== undefined && b.headerRows) {
        const tablePos = b.tablePos;
        for (let r = 0; r < b.headerRows; r++) {
          decos.push(
            Decoration.widget(
              b.pos,
              (view, getPos) => {
                const at = getPos() ?? b.pos;
                // Find this widget's table again: the closure's position is stale after edits.
                const $at = view.state.doc.resolve(at);
                let tpos = tablePos;
                for (let d = $at.depth; d > 0; d--) {
                  if ($at.node(d).type.name === 'table') {
                    tpos = $at.before(d);
                    break;
                  }
                }
                const tnode = view.state.doc.nodeAt(tpos);
                let rowPos = tpos + 1;
                for (let i = 0; i < r && tnode && i < tnode.childCount; i++) rowPos += tnode.child(i).nodeSize;
                const src = view.nodeDOM(rowPos) as HTMLElement | null;
                const clone = (src ? src.cloneNode(true) : document.createElement('tr')) as HTMLElement;
                clone.classList.add('pg-sp', 'pg-clone');
                clone.classList.remove('selectedCell');
                clone.querySelectorAll('.selectedCell').forEach((c) => c.classList.remove('selectedCell'));
                clone.removeAttribute('data-pm-slice');
                clone.setAttribute('aria-hidden', 'true');
                clone.contentEditable = 'false';
                return clone;
              },
              { side: -10 + r / 100, key: `c${r}:${b.headerSig ?? ''}`, ignoreSelection: true }
            )
          );
        }
      }
    }
  }
  return DecorationSet.create(doc, decos);
}
