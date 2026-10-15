/**
 * Taking a person to a match: the slide, the box, and the text selected in it.
 *
 * Normal view first (a match is shown on the slide, never in the sorter), then the slide, then the
 * box with the caret in it, then the match selected once the box's editor has been made, which is a
 * frame or two after the page asks for it (`findDom.ts`). A reader gets the box chosen and no caret,
 * and a table's cell its table chosen: its text is not typed in yet.
 */

import type { SlidesContext } from './types';
import { paragraphOf, type Match } from './findActions';
import { afterFrames, selectInEditor } from './findDom';

const none = (): void => undefined;

/** Goes to `m`. The result cancels the selection that is still waiting for its editor. */
export function showMatch(ctx: SlidesContext, m: Match): () => void {
  if (ctx.view !== 'normal') ctx.setView('normal');
  ctx.select.slide(m.slide);
  const expected = paragraphOf(ctx.model, m) ?? '';
  const select = (root: string) => () => {
    const pm = document.querySelector<HTMLElement>(root);
    return !!pm && selectInEditor(pm, m.para, m.start, m.end, expected);
  };
  if (m.place.kind === 'notes') {
    ctx.notes.setShown(true);
    return ctx.can.edit ? afterFrames(select('.sl-notes-body .sl-pm')) : none;
  }
  if (m.place.kind === 'cell' || !ctx.can.edit) {
    ctx.select.elements([m.place.el]);
    return none;
  }
  ctx.select.editText(m.place.el, 'end');
  return afterFrames(select('.sl-edit-box .sl-pm'));
}
