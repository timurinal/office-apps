/**
 * Custom sort: a block, whether its first row is a heading, and up to eight keys in order. The
 * block is the one a sort button would take (`regionFor`), and the keys are columns of it.
 */

import { useState } from 'react';
import { Button, IconButton, Select, Switch } from '../../core/controls';
import { Modal } from '../../core/ui';
import { xIcon } from '../../core/icons';
import { colToLetters, rectAddress } from '../grid/a1';
import { detectHeader, filterRect, regionFor, sortCustom, type SortLevel } from '../modules/dataActions';
import { Footer, type ToolProps } from './parts';

const MAX_LEVELS = 8;

export default function SortDialog({ ctx, onClose }: ToolProps) {
  const [rect] = useState(() => regionFor(ctx));
  const [header, setHeader] = useState(() => filterRect(ctx) !== null || detectHeader(ctx, rect));
  const [levels, setLevels] = useState<SortLevel[]>(() => {
    const { active } = ctx.selection();
    return [{ col: active.col >= rect.c1 && active.col <= rect.c2 ? active.col : rect.c1, descending: false }];
  });

  const cols: number[] = [];
  for (let c = rect.c1; c <= rect.c2; c++) cols.push(c);
  const name = (col: number) => {
    const head = header ? ctx.data.cell(rect.r1, col)?.text : '';
    return head ? `${head} (column ${colToLetters(col)})` : `Column ${colToLetters(col)}`;
  };
  const unused = cols.find((c) => !levels.some((l) => l.col === c));
  const set = (i: number, patch: Partial<SortLevel>) => setLevels((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const rows = rect.r2 - rect.r1 + (header ? 0 : 1);

  return (
    <Modal
      title="Sort"
      description={`${rectAddress(rect)}, ${rows.toLocaleString('en-GB')} ${rows === 1 ? 'row' : 'rows'}.`}
      width={520}
      onClose={onClose}
      footer={<Footer form="sx-sort" apply="Sort" onApply={() => sortCustom(ctx, rect, levels, header)} />}
    >
      <form id="sx-sort" className="sx-stack" onSubmit={(e) => e.preventDefault()}>
        <div className="sx-switch-row">
          <Switch checked={header} onChange={setHeader} label="The first row is a heading" />
          The first row is a heading
        </div>
        {levels.map((l, i) => (
          <div className="sx-level" key={i}>
            <Select
              label={i === 0 ? 'Sort by' : 'Then by'}
              value={String(l.col)}
              options={cols.map((c) => ({ value: String(c), label: name(c) }))}
              onChange={(v) => set(i, { col: Number(v) })}
            />
            <Select
              label="Order"
              value={l.descending ? 'desc' : 'asc'}
              options={[
                { value: 'asc', label: 'A to Z' },
                { value: 'desc', label: 'Z to A' }
              ]}
              onChange={(v) => set(i, { descending: v === 'desc' })}
              style={{ width: 120, flex: 'none' }}
            />
            <IconButton icon={xIcon} label="Remove this key" disabled={levels.length === 1} onClick={() => setLevels((all) => all.filter((_, j) => j !== i))} />
          </div>
        ))}
        <div>
          <Button variant="secondary" size="sm" disabled={unused === undefined || levels.length >= MAX_LEVELS} onClick={() => unused !== undefined && setLevels((all) => [...all, { col: unused, descending: false }])}>
            Add a key
          </Button>
        </div>
      </form>
    </Modal>
  );
}
