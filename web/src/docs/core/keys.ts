/**
 * The keyboard, where Word has a shortcut and the base list does not give one.
 *
 * What the base list already binds is left alone: Ctrl+B, I and U; Ctrl+Alt+1 to 6 for
 * headings and Ctrl+Alt+0 for Normal; Ctrl+Shift+7 and 8 for numbered and bulleted lists;
 * Ctrl+Z and Ctrl+Y; Ctrl+Shift+L, E, R and J to align (Docs'); Ctrl+, and Ctrl+. for
 * subscript and superscript (Docs'); Tab and Shift+Tab in lists and tables. This adds:
 *
 *   Ctrl+E, Ctrl+J            centre and justify, as Word does
 *   Ctrl+M, Ctrl+Shift+M      indent and outdent
 *   Ctrl+Space, Ctrl+\        clear formatting
 *   Ctrl+Shift+X              strikethrough
 *   Ctrl+Shift+9              a checklist (in lists.ts)
 *   Ctrl+F and Ctrl+H         find, and find and replace (in find.ts)
 *
 * **What is not taken, on purpose.** Word's Ctrl+L and Ctrl+R (left and right) and Ctrl+= and
 * Ctrl+Shift+= (sub and superscript) are the browser's: the address bar, reload and zoom. A
 * reload that right-aligns a paragraph, or a zoom that subscripts a word, changes the
 * document without being asked to, so the page leaves them alone and the Docs shortcuts
 * above do those jobs. The desktop app has no address bar and can bind them.
 *
 * ── Ctrl+K ──────────────────────────────────────────────────────────────────
 * **In the page, Ctrl+K is Insert link**, as in Word and in Docs. The command box
 * (CommandSearch) answers Ctrl+K everywhere else on the screen, and it is where
 * a person who has not clicked into the page lands. From inside the page the box is
 * Ctrl+/ , which focuses it. The page's handler stops the event, so the box's own
 * listener on the document never sees it. A reader, who has no page to type in, gets the
 * box on Ctrl+K as before.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { clearFormatting, setAlign } from './text';
import { indent } from './paragraph';
import { openLink } from './ui';

const PALETTE = 'input[role="combobox"][aria-label="Search or run a command"]';

export const shortcuts = Extension.create({
  name: 'oaShortcuts',

  addKeyboardShortcuts() {
    const e = () => this.editor;
    return {
      'Mod-e': () => setAlign(e(), 'center'),
      'Mod-j': () => setAlign(e(), 'justify'),
      'Mod-m': () => indent(e(), 1),
      'Mod-Shift-m': () => indent(e(), -1),
      'Mod-Shift-x': () => e().commands.toggleStrike(),
      'Mod-\\': () => clearFormatting(e()),
      'Mod-Space': () => clearFormatting(e())
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('oaShortcutKeys'),
        props: {
          handleKeyDown: (_view, event) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || !editor.isEditable) return false;
            if (event.key.toLowerCase() === 'k') {
              event.preventDefault();
              event.stopPropagation();
              openLink(editor);
              return true;
            }
            if (event.key === '/') {
              event.preventDefault();
              document.querySelector<HTMLInputElement>(PALETTE)?.focus();
              return true;
            }
            return false;
          }
        }
      })
    ];
  }
});
