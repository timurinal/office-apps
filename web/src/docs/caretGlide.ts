/**
 * Remote carets glide to where they move to, in 100ms, instead of jumping.
 *
 * The caret extension draws each remote person's caret as a widget and builds a
 * fresh element whenever their awareness changes, so there is no element to
 * transition. This plugin watches for the fresh ones, finds where the same person's
 * caret was a moment ago, and plays the distance back as a transform (the FLIP
 * shape in motion/flip.ts). Only a caret that is new since the last look animates,
 * so typing before somebody else's caret does not make it lag behind its own text,
 * and nothing here runs in a keystroke's handler: it is a frame later, and only
 * when a new caret has appeared.
 *
 * People are matched by name and colour, then by how many of the same there are
 * (one person in two tabs has two carets). Position is measured against the stage's
 * scroll, so scrolling is not mistaken for moving. Reduced motion plays nothing.
 */

import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { animate, DUR, EASE } from '../motion';

const CARET = '.collaboration-carets__caret';

/** The person a caret belongs to, as far as the DOM says: the label and the colour. */
export function caretKeys(carets: readonly Element[]): string[] {
  const seen = new Map<string, number>();
  return carets.map((el) => {
    const label = el.querySelector('.collaboration-carets__label')?.textContent ?? '';
    const base = `${label}\u0000${(el as HTMLElement).style.borderColor}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}\u0000${n}`;
  });
}

export const caretGlide = Extension.create({
  name: 'caretGlide',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: (view) => {
          const last = new Map<string, { x: number; y: number }>();
          let frame = 0;

          const pass = () => {
            frame = 0;
            const carets = [...view.dom.querySelectorAll<HTMLElement>(CARET)];
            const keys = caretKeys(carets);
            const scroller = view.dom.closest('.oa-stage');
            const scroll = scroller?.scrollTop ?? 0;
            const now = new Map<string, { x: number; y: number }>();
            carets.forEach((el, i) => {
              const r = el.getBoundingClientRect();
              const at = { x: r.left, y: r.top + scroll };
              const key = keys[i]!;
              now.set(key, at);
              if (el.dataset.seen) return;
              el.dataset.seen = '1';
              const was = last.get(key);
              if (!was) return;
              const dx = was.x - at.x;
              const dy = was.y - at.y;
              // Further than a screen is a jump, not a glide.
              if ((Math.abs(dx) < 1 && Math.abs(dy) < 1) || Math.abs(dy) > 600) return;
              animate(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
                duration: DUR.fast,
                easing: EASE.out,
                fill: 'none'
              });
            });
            last.clear();
            for (const [k, v] of now) last.set(k, v);
          };

          return {
            update: () => {
              if (frame) return;
              // A new caret is one the last pass has not marked.
              if (view.dom.querySelector(`${CARET}:not([data-seen])`)) frame = requestAnimationFrame(pass);
            },
            destroy: () => cancelAnimationFrame(frame)
          };
        }
      })
    ];
  }
});
