/**
 * The three small dialogs the right-click menus open: Link and Alt text for the chosen shapes, and
 * Format background for the slide.
 *
 * A menu row, a command in the Ctrl+K box and a key all want the same dialog and none of them is a
 * React parent of it, so which one is open is a store (`openSlideDialog`) and one overlay
 * (`SlideDialogs`, listed by the menus module) mounts it, the way Sheets' tools do. What each does is
 * one model step, so one Undo takes it back.
 *
 *   Link              an address for the whole text of the chosen shapes, checked as Docs checks one
 *                     (a web or mail address); Remove link takes it from them
 *   Alt text          what a screen reader says in place of the chosen shapes and pictures
 *   Format background  a colour, a gradient or a picture for the slide, or for every slide; each choice
 *                     is made at once, and the dialog stays for the next
 */

import { useState, useSyncExternalStore } from 'react';
import { Button, TextField } from '../../core/controls';
import { Modal, useModalClose } from '../../core/ui';
import { isSafeHref } from '../../docs/core/links';
import { normaliseLink } from '../../docs/links';
import type { Target } from '../editor/actions';
import { emptyText } from '../model/schema';
import { linkOf, setLink, shapesIn } from '../editor/linkText';
import type { Fill } from '../model/deck';
import { gradientCss } from '../render/paint';
import { backgroundTargets, GRADIENTS, readBackground, setBackground } from '../panes/format/background';
import { ColorPanel } from '../panes/format/ColorPicker';
import { altPatches, readAlt } from '../panes/format/edits';
import { envWriter } from '../panes/format/env';
import { Check } from '../panes/format/fields';
import { pictureProblem, pickPictureFiles, storePicture } from './insert/picture';
import type { SlidesContext } from './types';
import '../panes/format/design.css';

export type SlideDialog = 'link' | 'alt' | 'background';

// ── which one is open ───────────────────────────────────────────────────────

let current: { kind: SlideDialog; seq: number } | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openSlideDialog(kind: SlideDialog): void {
  current = { kind, seq: ++seq };
  emit();
}

/** With the `seq` of a dialog, only if that very one is still open. */
export function closeSlideDialog(of?: number): void {
  if (!current || (of !== undefined && current.seq !== of)) return;
  current = null;
  emit();
}

export const openSlideDialogNow = (): { kind: SlideDialog; seq: number } | null => current;

function useDialog() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null
  );
}

const target = (c: SlidesContext): Target => ({ model: c.model, selection: c.selection });

/** The chosen objects, as the model has them now. */
function chosen(c: SlidesContext) {
  const s = c.selection.get();
  return { slide: s.slide, els: s.slide ? s.els.map((id) => c.model.element(s.slide!, id)).filter((e) => e !== null) : [] };
}

// ── the host ────────────────────────────────────────────────────────────────

export function SlideDialogs({ ctx }: { ctx: SlidesContext }) {
  const open = useDialog();
  if (!open || !ctx.can.edit) return null;
  const onClose = () => {
    closeSlideDialog(open.seq);
    ctx.actions.focusCanvas();
  };
  if (open.kind === 'link') return <LinkDialog key={open.seq} c={ctx} onClose={onClose} />;
  if (open.kind === 'alt') return <AltTextDialog key={open.seq} c={ctx} onClose={onClose} />;
  return <BackgroundDialog key={open.seq} c={ctx} onClose={onClose} />;
}

// ── link ────────────────────────────────────────────────────────────────────

function LinkDialog({ c, onClose }: { c: SlidesContext; onClose: () => void }) {
  const { slide, els } = chosen(c);
  const shapes = shapesIn(els);
  const [href, setHref] = useState(() => {
    const all = new Set(shapes.map((s) => linkOf(s.text ?? emptyText())));
    return all.size === 1 ? ([...all][0] ?? '') : '';
  });
  const [error, setError] = useState('');
  const had = shapes.some((s) => linkOf(s.text ?? emptyText()) !== null);

  const write = (to: string | null): void => {
    if (!slide) return;
    c.model.setTexts(
      slide,
      shapes.map((s) => ({ id: s.id!, text: setLink(s.text ?? emptyText(), to) }))
    );
  };

  return (
    <Modal title="Link" description="The whole text of the shape links to this address." width={420} onClose={onClose} footer={<LinkFooter had={had} onRemove={() => write(null)} apply={() => {
      const address = normaliseLink(href);
      if (!address || !isSafeHref(address)) {
        setError('Enter a web or email address.');
        return false;
      }
      write(address);
      return true;
    }} />}>
      <form id="sl-link" onSubmit={(e) => e.preventDefault()}>
        <TextField
          label="Address"
          size="sm"
          autoFocus
          autoComplete="off"
          value={href}
          placeholder="Paste or type an address"
          error={error || undefined}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setHref(e.target.value);
            setError('');
          }}
        />
      </form>
    </Modal>
  );
}

function LinkFooter({ had, onRemove, apply }: { had: boolean; onRemove: () => void; apply: () => boolean }) {
  const close = useModalClose();
  return (
    <>
      {had && (
        <Button
          variant="ghost"
          onClick={() => {
            onRemove();
            close();
          }}
        >
          Remove link
        </Button>
      )}
      <span style={{ flex: 1 }} />
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
      <Button
        variant="primary"
        type="submit"
        form="sl-link"
        onClick={() => {
          if (apply()) close();
        }}
      >
        Apply
      </Button>
    </>
  );
}

// ── alt text ────────────────────────────────────────────────────────────────

function AltTextDialog({ c, onClose }: { c: SlidesContext; onClose: () => void }) {
  const { slide, els } = chosen(c);
  const [text, setText] = useState(() => readAlt(els)?.value ?? '');
  return (
    <Modal
      title="Alt text"
      description="What a screen reader says in place of the shape."
      width={420}
      onClose={onClose}
      footer={
        <AltFooter
          apply={() => {
            if (slide) envWriter(c.model, slide)(altPatches(els, text));
          }}
        />
      }
    >
      <form id="sl-alt" onSubmit={(e) => e.preventDefault()}>
        <TextField label="Description" multiline rows={3} autoFocus value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
      </form>
    </Modal>
  );
}

function AltFooter({ apply }: { apply: () => void }) {
  const close = useModalClose();
  return (
    <>
      <span style={{ flex: 1 }} />
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
      <Button
        variant="primary"
        type="submit"
        form="sl-alt"
        onClick={() => {
          apply();
          close();
        }}
      >
        Save
      </Button>
    </>
  );
}

// ── background ──────────────────────────────────────────────────────────────

function BackgroundDialog({ c, onClose }: { c: SlidesContext; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const [, again] = useState(0);
  const theme = c.design.theme;
  const here = readBackground(c.model, backgroundTargets(target(c), all))?.value ?? null;

  const apply = (bg: Fill | null) => {
    setBackground(target(c), bg, all);
    again((n) => n + 1);
  };
  const picture = () =>
    pickPictureFiles(
      (files) =>
        void storePicture(c.meta.id, files[0]!).then(
          (stored) => apply({ kind: 'image', asset: { id: stored.asset.id }, fit: 'cover' }),
          (err: unknown) => c.notify(pictureProblem(err, files[0]!.name))
        ),
      false
    );

  return (
    <Modal title="Format background" width={340} onClose={onClose} footer={<DoneFooter />}>
      <div className="sl-bg-dialog">
        <ColorPanel value={here?.kind === 'solid' ? here.color : null} theme={theme} onPick={(color) => apply({ kind: 'solid', color })} />
        <div className="sl-bg-section">
          <span className="sl-cp-title">Gradient</span>
          <div className="sl-bg-gradients" role="group" aria-label="Gradients">
            {GRADIENTS.map((g) => (
              <button
                key={g.id}
                type="button"
                className="sl-bg-gradient"
                title={g.label}
                aria-label={g.label}
                aria-pressed={here?.kind === 'gradient' && JSON.stringify(here) === JSON.stringify(g.fill)}
                style={{ background: gradientCss(g.fill, theme) ?? undefined }}
                onClick={() => apply(g.fill)}
              />
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '4px 2px' }}>
          {c.source.kind === 'cloud' && (
            <Button size="sm" variant="secondary" onClick={picture}>
              Picture…
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={here === null} onClick={() => apply(null)}>
            Reset background
          </Button>
        </div>
        <Check label="Apply to all slides" value={all} onChange={setAll} />
      </div>
    </Modal>
  );
}

function DoneFooter() {
  const close = useModalClose();
  return (
    <>
      <span style={{ flex: 1 }} />
      <Button variant="primary" onClick={close}>
        Done
      </Button>
    </>
  );
}
