/**
 * Text options: the type of the chosen shapes, or of the box with the caret.
 *
 * It formats through the same `TextFormat` the ribbon does (editor/format.ts), so a change is made as
 * the ribbon's would be: on the selected text while a box has the caret, on the whole text of every
 * chosen shape when none has, in one step. Text fill is the colour of the type, stored as the
 * ribbon's font colour is, `#rrggbb`; spacing is a paragraph's own line spacing and the space before
 * and after it.
 */

import { ColorPicker } from './ColorPicker';
import { readSpacing, shapesOf } from './edits';
import type { PaneEnv } from './env';
import { NumField, Row, Section } from './fields';
import type { Open } from './SizeTab';
import { formatMultiple, formatPoints, parseMultiple, parsePoints } from './units';

export function TextTab({ env, open, toggle }: { env: PaneEnv; open: Open; toggle: (key: string) => void }) {
  const { ctx, model, slide, theme, els, edit } = env;
  const text = ctx.text;
  const usable = edit && text.available();
  const spacing = readSpacing(shapesOf(els), (id, level) => model.styleAt(slide, id, level));
  const color = text.color();
  if (!text.available()) {
    return <p className="sl-fp-hint">Choose a shape with text to format it.</p>;
  }
  return (
    <>
      <Section title="Text fill" open={open.textFill!} onToggle={() => toggle('textFill')}>
        <Row label="Colour">
          <ColorPicker
            label="Text colour"
            value={color}
            empty="Automatic"
            theme={theme}
            mode="hex"
            disabled={!usable}
            clear={{ label: 'Automatic', run: () => text.setStyle({ color: null }) }}
            onPick={(c) => text.setStyle({ color: String(c) })}
          />
        </Row>
      </Section>
      <Section title="Paragraph" open={open.paragraph!} onToggle={() => toggle('paragraph')}>
        <Row label="Line spacing">
          <NumField label="Line spacing" value={text.editing() ? text.lineHeight() : (spacing.line?.value ?? null)} format={formatMultiple} parse={parseMultiple} step={0.1} min={0.5} max={5} disabled={!usable} onCommit={(n) => text.setParagraphs({ lineHeight: n })} />
        </Row>
        <Row label="Space before">
          <NumField label="Space before" value={spacing.before?.value ?? null} format={formatPoints} parse={parsePoints} step={1} min={0} max={400} disabled={!usable} onCommit={(n) => text.setParagraphs({ spaceBefore: n })} />
        </Row>
        <Row label="Space after">
          <NumField label="Space after" value={spacing.after?.value ?? null} format={formatPoints} parse={parsePoints} step={1} min={0} max={400} disabled={!usable} onCommit={(n) => text.setParagraphs({ spaceAfter: n })} />
        </Row>
      </Section>
    </>
  );
}
