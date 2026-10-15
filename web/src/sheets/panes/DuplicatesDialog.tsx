/** Remove duplicates: which columns decide that two rows are the same, and whether row one is a heading. */

import { useState } from 'react';
import { Switch } from '../../core/controls';
import { Modal } from '../../core/ui';
import { colToLetters, rectAddress } from '../grid/a1';
import { detectHeader, regionFor, removeDuplicates } from '../modules/dataActions';
import { Check, Footer, type ToolProps } from './parts';

export default function DuplicatesDialog({ ctx, onClose }: ToolProps) {
  const [rect] = useState(() => regionFor(ctx));
  const [header, setHeader] = useState(() => detectHeader(ctx, rect));
  const cols: number[] = [];
  for (let c = rect.c1; c <= rect.c2; c++) cols.push(c);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(cols));
  const name = (col: number) => {
    const head = header ? ctx.data.cell(rect.r1, col)?.text : '';
    return head || `Column ${colToLetters(col)}`;
  };
  const toggle = (col: number, on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      if (on) next.add(col);
      else next.delete(col);
      return next;
    });

  const apply = () => {
    const res = removeDuplicates(ctx, rect, [...picked].sort((a, b) => a - b), header);
    ctx.notify({
      text: res.removed === 0 ? 'No duplicates found.' : `Removed ${res.removed.toLocaleString('en-GB')} ${res.removed === 1 ? 'duplicate' : 'duplicates'}. ${res.unique.toLocaleString('en-GB')} unique ${res.unique === 1 ? 'row remains' : 'rows remain'}.`
    });
  };

  return (
    <Modal
      title="Remove duplicates"
      description={`Rows in ${rectAddress(rect)} that match an earlier row in every column ticked are removed.`}
      width={440}
      onClose={onClose}
      footer={<Footer form="sx-dup" apply="Remove" disabled={picked.size === 0 || rect.r1 === rect.r2} onApply={apply} />}
    >
      <form id="sx-dup" className="sx-stack" onSubmit={(e) => e.preventDefault()}>
        <div className="sx-switch-row">
          <Switch checked={header} onChange={setHeader} label="The first row is a heading" />
          The first row is a heading
        </div>
        <Check checked={picked.size === cols.length} onChange={(on) => setPicked(new Set(on ? cols : []))}>
          All columns
        </Check>
        <div className="sx-list" style={{ maxHeight: 220, padding: '4px 12px' }} role="group" aria-label="Columns">
          {cols.map((c) => (
            <div key={c} style={{ padding: '5px 0' }}>
              <Check checked={picked.has(c)} onChange={(on) => toggle(c, on)}>
                {name(c)}
              </Check>
            </div>
          ))}
        </div>
      </form>
    </Modal>
  );
}
