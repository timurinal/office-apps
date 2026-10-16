/**
 * Size and position: the chosen elements' own geometry, and below it, folded, the text box and the
 * alt text.
 *
 *   Size       height and width in centimetres, rotation in degrees, Lock aspect ratio
 *   Position   horizontal and vertical, measured from the top left corner or from the centre
 *   Text box   where the text sits (anchor), whether it wraps, how it fits, and its margins
 *   Alt text   what a screen reader says in place of a shape or a picture
 *
 * A value shows only when every chosen element has it, and an edit sets each of them in one step.
 * With the aspect locked, a width takes the height with it, each element by its own proportions. A
 * table's size scales its columns and rows with it (insert/tableOps.ts): its frame alone would not
 * move what is drawn.
 */

import { resizeTable } from '../../modules/insert/tableOps';
import type { TextBox } from '../../model/deck';
import { insetsOf } from '../../render/paint';
import {
  altPatches,
  lockPatches,
  positionPatches,
  readAlt,
  readLock,
  readPosition,
  readRotation,
  readSize,
  readTextBox,
  rotationPatches,
  shapesOf,
  sizePatches,
  textBoxPatches,
  withInset,
  type From
} from './edits';
import type { PaneEnv } from './env';
import { Check, CommitText, Dropdown, NumField, Row, Section, Seg, Stack } from './fields';
import { cmToPx, formatCm, formatDegrees, parseDegrees, parseLength } from './units';

/** Which sections are open, by key. */
export type Open = Record<string, boolean>;

const ANCHORS = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' }
] as const;

const AUTOFIT = [
  { value: 'none', label: 'Do not autofit' },
  { value: 'shrink', label: 'Shrink text on overflow' }
];

const FROM = [
  { value: 'topLeft', label: 'Top left' },
  { value: 'centre', label: 'Centre' }
];

const STEP = cmToPx(0.1);

export function SizeTab({ env, open, toggle, from, setFrom }: { env: PaneEnv; open: Open; toggle: (key: string) => void; from: From; setFrom: (from: From) => void }) {
  const { els, model, slide, write, edit } = env;
  const shapes = shapesOf(els);

  /** A width or a height: tables scale their columns and rows, everything else is one patch. */
  const size = (which: 'w' | 'h', px: number) => {
    write(sizePatches(
      els.filter((e) => e.type !== 'table'),
      which,
      px
    ));
    for (const t of els) {
      if (t.type !== 'table') continue;
      const k = t.lockAspect && t[which] > 0 ? px / t[which] : 1;
      resizeTable(model, slide, t.id!, which === 'w' ? px : t.w * k, which === 'h' ? px : t.h * k);
    }
  };

  const anchor = readTextBox(shapes, (b) => b.anchor ?? 'top');
  const fit = readTextBox(shapes, (b) => b.autofit ?? 'none');
  const wrap = readTextBox(shapes, (b) => b.wrap !== false);
  const inset = (key: 'l' | 't' | 'r' | 'b') => readTextBox(shapes, (b) => insetsOf(b)[key]);
  const setBox = (change: (b: TextBox) => TextBox) => write(textBoxPatches(shapes, change));

  const side = (label: string, key: 'l' | 't' | 'r' | 'b') => (
    <Row key={key} label={label}>
      <NumField label={`${label} margin`} value={inset(key)?.value ?? null} format={formatCm} parse={parseLength} step={STEP} min={0} max={cmToPx(10)} disabled={!edit} onCommit={(px) => setBox((b) => withInset(b, key, px))} />
    </Row>
  );

  return (
    <>
      <Section title="Size" open={open.size!} onToggle={() => toggle('size')}>
        <Row label="Height">
          <NumField label="Height" value={numOf(readSize(els, 'h'))} format={formatCm} parse={parseLength} step={STEP} min={0} max={cmToPx(200)} disabled={!edit} onCommit={(px) => size('h', px)} />
        </Row>
        <Row label="Width">
          <NumField label="Width" value={numOf(readSize(els, 'w'))} format={formatCm} parse={parseLength} step={STEP} min={0} max={cmToPx(200)} disabled={!edit} onCommit={(px) => size('w', px)} />
        </Row>
        <Row label="Rotation">
          <NumField label="Rotation" value={numOf(readRotation(els))} format={formatDegrees} parse={parseDegrees} step={1} min={0} max={359.99} disabled={!edit} onCommit={(d) => write(rotationPatches(els, d))} />
        </Row>
        <Check label="Lock aspect ratio" value={readLock(els)?.value ?? null} disabled={!edit} onChange={(on) => write(lockPatches(els, on))} />
      </Section>
      <Section title="Position" open={open.position!} onToggle={() => toggle('position')}>
        <Row label="Horizontal">
          <NumField label="Horizontal position" value={numOf(readPosition(els, 'x', from))} format={formatCm} parse={parseLength} step={STEP} min={-cmToPx(100)} max={cmToPx(100)} disabled={!edit} onCommit={(px) => write(positionPatches(els, 'x', px, from))} />
        </Row>
        <Row label="Vertical">
          <NumField label="Vertical position" value={numOf(readPosition(els, 'y', from))} format={formatCm} parse={parseLength} step={STEP} min={-cmToPx(100)} max={cmToPx(100)} disabled={!edit} onCommit={(px) => write(positionPatches(els, 'y', px, from))} />
        </Row>
        <Row label="From">
          <Dropdown label="Position from" value={from} options={FROM} onChange={(v) => setFrom(v as From)} />
        </Row>
      </Section>
      {shapes.length > 0 && (
        <Section title="Text box" open={open.textBox!} onToggle={() => toggle('textBox')}>
          <Stack label="Vertical alignment">
            <Seg label="Vertical alignment" value={anchor?.value ?? null} options={ANCHORS} disabled={!edit} onChange={(a) => setBox((b) => ({ ...b, anchor: a }))} />
          </Stack>
          <Stack label="Autofit">
            <Dropdown label="Autofit" value={fit?.value ?? null} options={AUTOFIT} disabled={!edit} onChange={(v) => setBox((b) => ({ ...b, autofit: v as TextBox['autofit'] }))} />
          </Stack>
          <Check label="Wrap text in shape" value={wrap?.value ?? null} disabled={!edit} onChange={(on) => setBox((b) => ({ ...b, wrap: on }))} />
          {side('Left', 'l')}
          {side('Right', 'r')}
          {side('Top', 't')}
          {side('Bottom', 'b')}
        </Section>
      )}
      <Section title="Alt text" open={open.alt!} onToggle={() => toggle('alt')}>
        <CommitText label="Alt text" value={readAlt(els)?.value ?? null} multiline disabled={!edit} onCommit={(t) => write(altPatches(els, t))} />
      </Section>
    </>
  );
}

const numOf = (r: { value: number } | null): number | null => (r ? r.value : null);
