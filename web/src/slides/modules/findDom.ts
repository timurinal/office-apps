/**
 * Putting the page's selection on a match, in the text box or the notes that are on screen.
 *
 * The text boxes are ProseMirror editors (editor/TextEditor.tsx), and the page has no handle on one,
 * so a match is selected the way a person selects: a DOM range over the paragraph's text nodes, which
 * ProseMirror reads back as its own selection while it has the focus. The range is found by counting
 * characters the way the search does (`findActions.ts`): a text node's length, a `<br>` as one, and
 * nothing for what the editor draws that is not text (a bullet, another person's caret).
 *
 * Best effort: when the editor is not there yet, or its paragraph is not the one searched, nothing is
 * selected and the box is simply the one entered.
 */

const NOT_TEXT = '[contenteditable="false"], .sl-caret, .sl-caret-label, .ProseMirror-trailingBreak, .ProseMirror-separator';

const isNotText = (el: Element): boolean => el.matches(NOT_TEXT);

/** The editors' paragraphs: the `<p>`s directly under the editor's root. */
export const paragraphsIn = (pm: Element): HTMLElement[] => [...pm.children].filter((c): c is HTMLElement => c.tagName === 'P');

/** A paragraph's text as the search counts it, read back off the page. */
export function domText(p: Element): string {
  let out = '';
  const walk = (n: Node): void => {
    for (const child of n.childNodes) {
      if (child.nodeType === 3) out += (child as Text).data;
      else if (child instanceof Element && !isNotText(child)) {
        if (child.tagName === 'BR') out += '\n';
        else walk(child);
      }
    }
  };
  walk(p);
  return out;
}

export interface DomPoint {
  node: Node;
  offset: number;
}

/**
 * The text node and offset in `p` at `offset` characters in. A start belongs to the character after
 * it, an end to the character before it, so a match that ends where a run ends stays inside that run.
 */
export function domPoint(p: Element, offset: number, edge: 'start' | 'end'): DomPoint | null {
  let seen = 0;
  let last: DomPoint | null = null;
  let found: DomPoint | null = null;
  const walk = (n: Node): void => {
    for (const child of n.childNodes) {
      if (found) return;
      if (child.nodeType === 3) {
        const len = (child as Text).data.length;
        if (edge === 'start' ? offset < seen + len : offset <= seen + len) {
          found = { node: child, offset: offset - seen };
          return;
        }
        seen += len;
        last = { node: child, offset: len };
      } else if (child instanceof Element && !isNotText(child)) {
        if (child.tagName === 'BR') seen += 1;
        else walk(child);
      }
    }
  };
  walk(p);
  return found ?? last;
}

/**
 * Selects `start` to `end` of paragraph `para` of the editor `pm`, and gives it the keyboard.
 * False when the editor's paragraph is not the one searched (`expected` is its text).
 */
export function selectInEditor(pm: HTMLElement, para: number, start: number, end: number, expected: string): boolean {
  const p = paragraphsIn(pm)[para];
  if (!p || domText(p) !== expected) return false;
  const a = domPoint(p, start, 'start');
  const b = domPoint(p, end, 'end');
  const sel = pm.ownerDocument.getSelection();
  if (!a || !b || !sel) return false;
  pm.focus({ preventScroll: true });
  const range = pm.ownerDocument.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

/**
 * Runs `try_` on each frame until it says it is done, for at most `frames`: an editor is made in a
 * layout effect after the selection that asked for it, so it is there a frame or two later.
 */
export function afterFrames(try_: () => boolean, frames = 24): () => void {
  let id = 0;
  let left = frames;
  const tick = () => {
    if (try_() || --left <= 0) return;
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}
