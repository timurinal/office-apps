/**
 * Page setup: paper, orientation, margins, and where the header and footer sit.
 *
 * Its own chunk, loaded the first time it opens. Lengths are shown in inches where the
 * paper default is Letter (en-US) and in centimetres everywhere else, and are stored in
 * millimetres either way, so two people in two countries edit the same numbers.
 */

import { useState, type ReactNode } from 'react';
import { Button, Select, Switch, TextField } from '../../core/controls';
import { Modal, useModalClose } from '../../core/ui';
import { rulerIcon } from './icons';
import { MARGIN_PRESETS, PAPER, PAPER_SIZES, defaultSize, marginsFit, presetOf, type Margins, type Orientation, type PaperSize } from './setup';
import type { PageStore } from './store';

const SIDES = ['top', 'bottom', 'left', 'right'] as const;
type Side = (typeof SIDES)[number];
const SIDE_LABEL: Record<Side, string> = { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right' };

/** The unit this reader thinks in. */
const unitFor = (): { name: string; mm: number; step: number } =>
  defaultSize() === 'Letter' ? { name: 'in', mm: 25.4, step: 0.1 } : { name: 'cm', mm: 10, step: 0.1 };

const show = (mm: number, perUnit: number): string => String(Math.round((mm / perUnit) * 100) / 100);
const read = (text: string, perUnit: number): number => {
  const v = Number(text.trim().replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(v) ? Number.NaN : v * perUnit;
};

const PAPER_OPTIONS = PAPER_SIZES.map((s) => ({ value: s, label: PAPER[s].label }));
const ORIENTATION_OPTIONS = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' }
];
const PRESET_OPTIONS = [...MARGIN_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom' }];

export default function PageSetupDialog({ store, onClose }: { store: PageStore; onClose: () => void }) {
  const start = store.setup;
  const unit = unitFor();
  const [size, setSize] = useState<PaperSize>(start.size);
  const [orientation, setOrientation] = useState<Orientation>(start.orientation);
  const [preset, setPreset] = useState<string>(presetOf(start.margins) ?? 'custom');
  const [margins, setMargins] = useState<Record<Side, string>>({
    top: show(start.margins.top, unit.mm),
    bottom: show(start.margins.bottom, unit.mm),
    left: show(start.margins.left, unit.mm),
    right: show(start.margins.right, unit.mm)
  });
  const [header, setHeader] = useState(show(start.headerDistance, unit.mm));
  const [footer, setFooter] = useState(show(start.footerDistance, unit.mm));
  const [differentFirst, setDifferentFirst] = useState(start.differentFirst);

  const mm: Margins = { top: read(margins.top, unit.mm), right: read(margins.right, unit.mm), bottom: read(margins.bottom, unit.mm), left: read(margins.left, unit.mm) };
  const headerMM = read(header, unit.mm);
  const footerMM = read(footer, unit.mm);
  const marginsOk = marginsFit({ size, orientation }, mm);
  const distanceOk = (v: number) => Number.isFinite(v) && v >= 0 && v <= 100;
  const canWrite = store.control?.canWrite() ?? false;
  const ok = marginsOk && distanceOk(headerMM) && distanceOk(footerMM) && canWrite;

  const choosePreset = (id: string) => {
    setPreset(id);
    const p = MARGIN_PRESETS.find((x) => x.id === id);
    if (p) setMargins({ top: show(p.margins.top, unit.mm), bottom: show(p.margins.bottom, unit.mm), left: show(p.margins.left, unit.mm), right: show(p.margins.right, unit.mm) });
  };
  const setSide = (side: Side, text: string) => {
    const next = { ...margins, [side]: text };
    setMargins(next);
    const asMM: Margins = { top: read(next.top, unit.mm), right: read(next.right, unit.mm), bottom: read(next.bottom, unit.mm), left: read(next.left, unit.mm) };
    setPreset(presetOf(asMM) ?? 'custom');
  };

  // Only what differs from the document is written (writeSetup), so Apply with no change writes nothing.
  const apply = (): void => {
    if (ok) store.control?.setSetup({ size, orientation, margins: mm, headerDistance: headerMM, footerDistance: footerMM, differentFirst });
  };
  const tooFar = `Enter a distance of ${unit.name === 'in' ? '3.9 in' : '10 cm'} or less.`;

  const unitTag = <span style={{ paddingRight: 10, fontSize: 12, color: 'var(--fg-3)' }}>{unit.name}</span>;
  const lengthField = (label: string, value: string, onChange: (v: string) => void, error?: string) => (
    <TextField label={label} type="number" inputMode="decimal" min={0} step={unit.step} value={value} trailing={unitTag} onChange={(e) => onChange(e.target.value)} {...(error ? { error } : {})} />
  );

  return (
    <Modal title="Page setup" icon={rulerIcon} width={520} onClose={onClose} footer={<Footer ok={ok} apply={apply} />}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 4 }}
      >
        <Section title="Paper">
          <Select label="Size" value={size} options={PAPER_OPTIONS} onChange={(v) => setSize(v as PaperSize)} />
          <Select label="Orientation" value={orientation} options={ORIENTATION_OPTIONS} onChange={(v) => setOrientation(v as Orientation)} />
        </Section>

        <Section title="Margins">
          <div style={{ gridColumn: '1 / -1' }}>
            <Select label="Preset" value={preset} options={PRESET_OPTIONS} onChange={choosePreset} />
          </div>
          {SIDES.map((side) => (
            <div key={side}>{lengthField(SIDE_LABEL[side], margins[side], (v) => setSide(side, v))}</div>
          ))}
          {!marginsOk && (
            <p role="alert" style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12, color: 'var(--danger, #c0392b)' }}>
              The margins leave too little room for text.
            </p>
          )}
        </Section>

        <Section title="Header and footer">
          {lengthField('Header from edge', header, setHeader, distanceOk(headerMM) ? undefined : tooFar)}
          {lengthField('Footer from edge', footer, setFooter, distanceOk(footerMM) ? undefined : tooFar)}
          <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--fg-1)' }}>
            <Switch checked={differentFirst} label="Different first page" onChange={setDifferentFirst} />
            Different first page
          </label>
        </Section>
      </form>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend style={{ padding: 0, marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--fg-2)' }}>{title}</legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>{children}</div>
    </fieldset>
  );
}

function Footer({ ok, apply }: { ok: boolean; apply: () => void }) {
  const close = useModalClose();
  return (
    <>
      <span style={{ flex: 1 }} />
      <Button onClick={close}>Cancel</Button>
      <Button
        variant="primary"
        disabled={!ok}
        onClick={() => {
          apply();
          close();
        }}
      >
        Apply
      </Button>
    </>
  );
}
