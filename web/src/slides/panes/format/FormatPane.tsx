/**
 * The Format pane: "Format shape", on the right edge, as the Slides board draws it.
 *
 *   Shape options   three tools in a row (Fill and line, Effects, Size and position), and for a chart
 *                   or a table, a tool of its own; under them the sections of the one that is open
 *   Text options    the type of the chosen shapes: its colour, and the paragraph's spacing
 *
 * It follows what is chosen on the slide and nothing else: it holds no copy of the deck, reads the
 * chosen elements from the model (re-drawn only when something it shows changes: typing in a chosen
 * shape does not redraw it) and writes through the model, so every change is one step, one undo
 * entry, and live for the other person. A value that differs across the selection is blank.
 */

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../../core/icons';
import { UnderlineTabs } from '../../../core/controls';
import type { ElementJSON } from '../../model/deck';
import type { SlideModel } from '../../model/model';
import { cornersOutIcon } from '../../modules/icons';
import { chartBarIcon, circleIcon, paintBucketIcon, tableIcon } from '../../modules/insert/icons';
import type { SlidesContext } from '../../modules/types';
import { useSelection, type Selection } from '../../editor/selection';
import { useDeckSlice } from '../../useSlideModel';
import { ChartTab } from './ChartTab';
import { sameFormat, shapesOf, strokablesOf, type From } from './edits';
import { envWriter, type PaneEnv } from './env';
import { Section } from './fields';
import { EffectsTab, FillSection, LineSection } from './FillTab';
import { SizeTab, type Open } from './SizeTab';
import { TableTab } from './TableTab';
import { TextTab } from './TextTab';
import './format.css';

type Top = 'shape' | 'text';
type Sub = 'fill' | 'effects' | 'size' | 'chart' | 'table';

const EMPTY: readonly ElementJSON[] = [];

/** The chosen elements, re-read only when one of them changes in a way the pane shows. */
export function useChosen(model: SlideModel, sel: Selection, text: boolean): readonly ElementJSON[] {
  const slide = sel.slide;
  const ids = sel.els.join(',');
  return (
    useDeckSlice<readonly ElementJSON[]>(
      model,
      (m) => (slide ? sel.els.map((id) => m.element(slide, id)).filter((e): e is ElementJSON => e !== null) : EMPTY),
      (c) => c.design || (slide !== null && c.slides.has(slide)),
      (a, b) => sameFormat(a, b, text),
      `${slide}|${ids}|${text}`
    ) ?? EMPTY
  );
}

const SUBS: Record<Sub, { label: string; icon: string }> = {
  fill: { label: 'Fill and line', icon: paintBucketIcon },
  effects: { label: 'Effects', icon: circleIcon },
  size: { label: 'Size and position', icon: cornersOutIcon },
  chart: { label: 'Chart', icon: chartBarIcon },
  table: { label: 'Table', icon: tableIcon }
};

/** Which of the tools apply to what is chosen. */
export function subsFor(els: readonly ElementJSON[]): Sub[] {
  const single = els.length === 1 ? els[0]! : null;
  const out: Sub[] = [];
  if (single?.type === 'table') out.push('table');
  if (els.some((e) => e.type === 'chart')) out.push('chart');
  if (shapesOf(els).length || strokablesOf(els).length) out.push('fill');
  if (shapesOf(els).length) out.push('effects');
  out.push('size');
  return out;
}

const OPEN: Open = { fill: true, line: true, size: true, position: true, textBox: false, alt: false, textFill: true, paragraph: true };

export function FormatPane({ ctx }: { ctx: SlidesContext }) {
  const sel = useSelection(ctx.selection);
  const [top, setTop] = useState<Top>('shape');
  const [pick, setPick] = useState<Sub>('fill');
  const [open, setOpen] = useState<Open>(OPEN);
  const [from, setFrom] = useState<From>('topLeft');
  const els = useChosen(ctx.model, sel, top === 'text');
  const slide = sel.slide;

  const subs = subsFor(els);
  const sub: Sub = subs.includes(pick) ? pick : subs[0]!;
  // A table or a chart that is newly chosen opens its own tool; moving off one goes back to the others.
  const own = subs.includes('table') ? 'table' : subs.includes('chart') ? 'chart' : null;
  useEffect(() => {
    if (own) setPick(own);
    else setPick((p) => (p === 'table' || p === 'chart' ? 'fill' : p));
  }, [own, slide, els.length]);

  const write = useMemo(() => (slide ? envWriter(ctx.model, slide) : () => undefined), [ctx.model, slide]);
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  if (!slide || !els.length) {
    return <p className="sl-fp-hint sl-fp-empty">Choose a shape, picture or table to format it.</p>;
  }

  const env: PaneEnv = { ctx, model: ctx.model, slide, els, theme: ctx.design.theme, edit: ctx.can.edit, write };
  const shapes = shapesOf(els).length > 0;
  const strokes = strokablesOf(els).length > 0;

  return (
    // Escape in a field puts the old value back; with nothing to put back it gives the slide the keyboard.
    <div
      className="sl-fp"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) ctx.actions.focusCanvas();
      }}
    >
      <UnderlineTabs
        label="Format options"
        value={top}
        onChange={(v) => setTop(v as Top)}
        items={[
          { value: 'shape', label: 'Shape options' },
          { value: 'text', label: 'Text options' }
        ]}
      />
      <div className="sl-fp-scroll">
        {top === 'shape' ? (
          <>
            <div className="sl-fp-icons" role="group" aria-label="Shape options">
              {subs.map((s) => (
                <button key={s} type="button" className="sl-fp-ib" aria-label={SUBS[s].label} title={SUBS[s].label} aria-pressed={sub === s} onClick={() => setPick(s)}>
                  <Icon icon={SUBS[s].icon} size={16} />
                </button>
              ))}
            </div>
            <div className="sl-fp-sections">
              {sub === 'fill' && (
                <>
                  {shapes && (
                    <Section title="Fill" open={open.fill!} onToggle={() => toggle('fill')}>
                      <FillSection env={env} />
                    </Section>
                  )}
                  {strokes && (
                    <Section title="Line" open={open.line!} onToggle={() => toggle('line')}>
                      <LineSection env={env} />
                    </Section>
                  )}
                </>
              )}
              {sub === 'effects' && <EffectsTab env={env} />}
              {sub === 'size' && <SizeTab env={env} open={open} toggle={toggle} from={from} setFrom={setFrom} />}
              {sub === 'chart' && <ChartTab env={env} />}
              {sub === 'table' && <TableTab env={env} />}
            </div>
          </>
        ) : (
          <div className="sl-fp-sections">
            <TextTab env={env} open={open} toggle={toggle} />
          </div>
        )}
      </div>
    </div>
  );
}
