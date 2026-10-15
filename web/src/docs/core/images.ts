/**
 * Pictures: the node, dropping and pasting them in, and inserting from a file.
 *
 * ── The node ────────────────────────────────────────────────────────────────
 * Tiptap's image, resizable from its corners (the aspect ratio is kept), with an `align`.
 * Its `src` is only ever a picture of this document, or a raster data URL (sanitize.ts
 * `safeImageSrc`): the page's policy refuses to load anything else, and a pasted
 * `<img src="https://…">` is dropped rather than stored as a broken picture.
 *
 * ── Getting one in ──────────────────────────────────────────────────────────
 * From a file picker, a paste of image files, or a drop. All three end in
 * `insertImageFiles`, which prepares each (imageFiles.ts), stores it, and only then
 * inserts the node. A picture is not inserted while it uploads: every other person in the
 * room would see the same placeholder and a `blob:` URL that is nobody's but this tab's.
 * Instead a placeholder is drawn here, as a decoration, which is not in the document and
 * is mapped through whatever the other people type meanwhile.
 */

import { Extension, type Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { LIMITS } from '@shared/api';
import { errorText } from '../../api';
import { ctxOf } from './env';
import { blobToDataUrl, displaySize, INLINE_PROFILE, isImageFile, prepareImage, SERVER_PROFILE, uploadAsset, ImageTooLarge } from './imageFiles';
import { safeImageSrc } from './sanitize';

export type ImageAlign = 'left' | 'center' | 'right';

const num = (v: string | null): number | null => {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 8 && n <= 6000 ? Math.round(n) : null;
};

const imageBase = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => safeImageSrc(el.getAttribute('src')),
        renderHTML: (attrs: Record<string, unknown>) => ({ src: safeImageSrc(attrs.src) })
      },
      width: { default: null, parseHTML: (el: HTMLElement) => num(el.getAttribute('width')) },
      height: { default: null, parseHTML: (el: HTMLElement) => num(el.getAttribute('height')) },
      align: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('data-align');
          return v === 'center' || v === 'right' ? v : null;
        },
        renderHTML: (attrs: Record<string, unknown>) => (attrs.align === 'center' || attrs.align === 'right' ? { 'data-align': attrs.align } : {})
      }
    };
  },

  // A pasted picture with no usable source is not a picture.
  parseHTML() {
    return [{ tag: 'img[src]', getAttrs: (el) => (safeImageSrc((el as HTMLElement).getAttribute('src')) ? null : false) }];
  },

  // The resize wrapper is the thing in the page, so the alignment goes on it, and is kept
  // there as the node changes.
  addNodeView() {
    const parent = this.parent?.();
    if (!parent) return null;
    return (props) => {
      const view = parent(props);
      const place = (node: { attrs: Record<string, unknown> }) => {
        const dom = (view as { dom: HTMLElement }).dom;
        const a = node.attrs.align as ImageAlign | null;
        dom.dataset.align = a ?? 'left';
        dom.style.justifyContent = a === 'center' ? 'center' : a === 'right' ? 'flex-end' : 'flex-start';
      };
      place(props.node);
      const update = view.update?.bind(view);
      if (update) {
        view.update = (node, ...rest) => {
          const ok = update(node, ...rest);
          if (ok) place(node);
          return ok;
        };
      }
      return view;
    };
  }
});

export const imageNode = imageBase.configure({
  inline: false,
  allowBase64: true,
  resize: { enabled: true, directions: ['bottom-right', 'bottom-left', 'top-right', 'top-left'], minWidth: 48, minHeight: 24, alwaysPreserveAspectRatio: true }
});

// ── placeholders ────────────────────────────────────────────────────────────

const pendingKey = new PluginKey<DecorationSet>('oaImagePending');

type PendingMeta = { add: { id: string; pos: number; name: string } } | { remove: string };

function placeholder(name: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'oa-img-pending';
  el.contentEditable = 'false';
  el.setAttribute('role', 'status');
  const dot = document.createElement('span');
  dot.className = 'oa-img-pending-dot';
  const label = document.createElement('span');
  label.textContent = `Adding ${name}`;
  el.appendChild(dot);
  el.appendChild(label);
  return el;
}

const pendingPos = (state: EditorState, id: string): number | null =>
  pendingKey.getState(state)?.find(undefined, undefined, (spec) => spec.id === id)[0]?.from ?? null;

const pendingPlugin = new Plugin<DecorationSet>({
  key: pendingKey,
  state: {
    init: () => DecorationSet.empty,
    apply(tr, set) {
      let next = set.map(tr.mapping, tr.doc);
      const meta = tr.getMeta(pendingKey) as PendingMeta | undefined;
      if (meta && 'add' in meta) {
        next = next.add(tr.doc, [Decoration.widget(meta.add.pos, () => placeholder(meta.add.name), { id: meta.add.id, side: -1, ignoreSelection: true })]);
      } else if (meta && 'remove' in meta) {
        next = next.remove(next.find(undefined, undefined, (spec) => spec.id === meta.remove));
      }
      return next;
    }
  },
  props: {
    decorations: (state) => pendingKey.getState(state) ?? DecorationSet.empty
  }
});

let counter = 0;

/**
 * Prepare, store and insert each picture, one after another, at `at` (default: the
 * selection). Answers how many were inserted. A picture that cannot be stored says why in
 * a toast and the others carry on.
 */
export async function insertImageFiles(editor: Editor, files: readonly File[], at?: number): Promise<number> {
  const ctx = ctxOf(editor);
  const images = files.filter(isImageFile);
  if (images.length === 0) return 0;
  const notify = ctx?.notify ?? (() => undefined);
  const inline = !ctx || ctx.source.kind !== 'cloud';
  let inserted = 0;
  let where = at ?? editor.state.selection.to;

  for (const file of images) {
    if (editor.isDestroyed) break;
    const id = `img${++counter}`;
    editor.view.dispatch(editor.state.tr.setMeta(pendingKey, { add: { id, pos: where, name: file.name || 'picture' } } satisfies PendingMeta).setMeta('addToHistory', false));
    try {
      const prepared = await prepareImage(file, inline ? INLINE_PROFILE : SERVER_PROFILE);
      const src = inline ? await blobToDataUrl(prepared.blob) : (await uploadAsset(ctx!.meta.id, prepared)).url;
      const size = displaySize(prepared.width, prepared.height);
      const range = blockSpot(editor.state, pendingPos(editor.state, id) ?? where);
      const ok = editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta(pendingKey, { remove: id } satisfies PendingMeta);
          return true;
        })
        .insertContentAt(range, { type: 'image', attrs: { src, alt: stripExtension(prepared.name), width: size.width, height: size.height } })
        .run();
      if (ok) {
        inserted += 1;
        where = editor.state.selection.to;
      }
    } catch (err) {
      editor.view.dispatch(editor.state.tr.setMeta(pendingKey, { remove: id } satisfies PendingMeta).setMeta('addToHistory', false));
      notify({
        text:
          err instanceof ImageTooLarge
            ? `${file.name || 'That image'} is too large.`
            : errorText(err, `Could not add ${file.name || 'that image'}.`),
        tone: 'danger'
      });
    }
  }
  return inserted;
}

/**
 * Where a block picture goes for a caret at `pos`: not in the middle of a paragraph, which
 * it would split in two, but after it. A caret in an empty paragraph is that paragraph's
 * place, and the picture takes it (so the range is the paragraph, and not a point).
 */
export function blockSpot(state: EditorState, pos: number): { from: number; to: number } {
  const $pos = state.doc.resolve(Math.min(Math.max(pos, 0), state.doc.content.size));
  if (!$pos.parent.isTextblock) return { from: $pos.pos, to: $pos.pos };
  if ($pos.parent.content.size === 0 && $pos.parent.type.name === 'paragraph') return { from: $pos.before(), to: $pos.after() };
  const after = $pos.after();
  return { from: after, to: after };
}

const stripExtension = (name: string): string => name.replace(/\.[A-Za-z0-9]{1,5}$/, '');

/** Paste and drop: image files go through `insertImageFiles`. Text and HTML are Tiptap's. */
export const imageIntake = Extension.create({
  name: 'oaImageIntake',

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      pendingPlugin,
      new Plugin({
        key: new PluginKey('oaImageIntake'),
        props: {
          handlePaste: (_view, event) => {
            const files = [...(event.clipboardData?.files ?? [])].filter(isImageFile);
            if (files.length === 0) return false;
            event.preventDefault();
            void insertImageFiles(editor, files);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false;
            const files = [...(event.dataTransfer?.files ?? [])].filter(isImageFile);
            if (files.length === 0) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            void insertImageFiles(editor, files, at);
            return true;
          }
        }
      })
    ];
  }
});

/** Used by tests that need to know when the last placeholder is gone. */
export const pendingCount = (editor: Editor): number => pendingKey.getState(editor.state)?.find().length ?? 0;

/** Ask for picture files and insert them: Insert > Picture, and the palette's command. */
export function pickPictureFiles(editor: Editor): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = LIMITS.assetMimes.join(',');
  input.multiple = true;
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    if (files.length > 0) void insertImageFiles(editor, files);
  };
  input.click();
}
