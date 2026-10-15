/** Text to columns: split one column across the columns to its right, with a preview of the first rows. */

import { useMemo, useState } from 'react';
import { Switch, TextField } from '../../core/controls';
import { Modal } from '../../core/ui';
import { rectAddress } from '../grid/a1';
import { regionFor, SEPARATORS, splitTarget, splitText, textToColumns } from '../modules/dataActions';
import { Check, Footer, type ToolProps } from './parts';

const PREVIEW = 5;

export default function TextToColumnsDialog({ ctx, onClose }: ToolProps) {
  const [rect] = useState(() => {
    // One cell means the column of data it is in.
    const r = regionFor(ctx);
    return { ...r, c2: r.c1 };
  });
  const sel = ctx.selection().rect;
  const wide = sel.c1 !== sel.c2;
  const [on, setOn] = useState<Set<string>>(() => new Set(['comma']));
  const [other, setOther] = useState('');
  const [merge, setMerge] = useState(false);

  const chars = useMemo(() => {
    const c = SEPARATORS.filter((s) => on.has(s.id)).map((s) => s.char);
    if (other) for (const ch of other) if (!c.includes(ch)) c.push(ch);
    return c;
  }, [on, other]);

  const rows = useMemo(() => {
    const out: string[][] = [];
    for (let r = rect.r1; r <= Math.min(rect.r2, rect.r1 + PREVIEW - 1); r++) {
      const text = ctx.data.editText(r, rect.c1);
      out.push(chars.length && text ? splitText(text, { chars, merge }) : [text]);
    }
    return out;
  }, [ctx.data, rect, chars, merge]);
  const width = Math.max(1, ...rows.map((r) => r.length));
  const clobber = chars.length ? splitTarget(ctx, rect, width) : null;

  return (
    <Modal
      title="Text to columns"
      description={wide ? 'Select one column to split.' : `Splits ${rectAddress(rect)} across the columns to its right.`}
      width={500}
      onClose={onClose}
      footer={
        <Footer
          form="sx-split"
          apply="Split"
          disabled={wide || width <= 1}
          onApply={() => {
            const n = textToColumns(ctx, rect, { chars, merge });
            if (n === 0) ctx.notify({ text: 'Nothing to split.' });
          }}
        />
      }
    >
      <form id="sx-split" className="sx-stack" onSubmit={(e) => e.preventDefault()}>
        <div role="group" aria-label="Separators" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
          {SEPARATORS.map((s) => (
            <Check
              key={s.id}
              checked={on.has(s.id)}
              onChange={(v) =>
                setOn((p) => {
                  const next = new Set(p);
                  if (v) next.add(s.id);
                  else next.delete(s.id);
                  return next;
                })
              }
            >
              {s.label}
            </Check>
          ))}
        </div>
        <TextField label="Another separator" size="sm" value={other} maxLength={4} onChange={(e) => setOther(e.target.value)} placeholder="For example |" />
        <div className="sx-switch-row">
          <Switch checked={merge} onChange={setMerge} label="Treat separators in a row as one" />
          Treat separators in a row as one
        </div>
        <div className="sx-list" style={{ padding: 8 }} aria-label="Preview">
          <table className="sx-mono" style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {Array.from({ length: width }, (_, k) => (
                    <td key={k} style={{ padding: '3px 8px', boxShadow: 'inset 0 0 0 1px var(--bd-faint)', whiteSpace: 'nowrap' }}>
                      {r[k] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {clobber && (
          <p className="sx-note" data-tone="danger">
            Replaces what is in {clobber}.
          </p>
        )}
      </form>
    </Modal>
  );
}
