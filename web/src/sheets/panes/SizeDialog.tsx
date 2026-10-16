/**
 * Column width and Row height: one number in px, as the grid stores it, for every column or row the
 * selection covers. One step, so one Undo takes it back. The model's own ceiling is the upper end, and
 * a line too narrow to see is the lower (hiding is its own row in the menu).
 */

import { useState } from 'react';
import { TextField } from '../../core/controls';
import { Modal } from '../../core/ui';
import { colToLetters } from '../grid/a1';
import { currentSize, lineSpan, setLineSize, SIZE_LIMITS, type Axis } from '../modules/actions';
import { Footer, type ToolProps } from './parts';
import './tools.css';

/** "Column B", "Columns B to D", "Row 3", "Rows 3 to 5". */
export function describeLines(axis: Axis, from: number, to: number): string {
  const name = (n: number) => (axis === 'col' ? colToLetters(n) : String(n + 1));
  const noun = axis === 'col' ? 'Column' : 'Row';
  return from === to ? `${noun} ${name(from)}.` : `${noun}s ${name(from)} to ${name(to)}.`;
}

export default function SizeDialog({ ctx, onClose, axis }: ToolProps & { axis: Axis }) {
  const [text, setText] = useState(() => String(currentSize(ctx, axis)));
  const [error, setError] = useState('');
  const { min, max } = SIZE_LIMITS[axis];
  const { from, to } = lineSpan(ctx, axis);
  const noun = axis === 'col' ? 'width' : 'height';

  const apply = (): boolean => {
    const typed = text.trim();
    if (typed === '' || !/^\d+(\.\d+)?$/.test(typed) || !setLineSize(ctx, axis, Number(typed))) {
      setError(`Enter a ${noun} from ${min} to ${max}.`);
      return false;
    }
    return true;
  };

  return (
    <Modal
      title={axis === 'col' ? 'Column width' : 'Row height'}
      description={describeLines(axis, from, to)}
      width={360}
      onClose={onClose}
      footer={<Footer form="sx-size" apply={axis === 'col' ? 'Set width' : 'Set height'} onApply={apply} />}
    >
      <form id="sx-size" onSubmit={(e) => e.preventDefault()}>
        <TextField
          label={axis === 'col' ? 'Width' : 'Height'}
          size="sm"
          inputMode="numeric"
          autoFocus
          autoComplete="off"
          value={text}
          error={error || undefined}
          trailing={<span className="sx-unit">px</span>}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
        />
      </form>
    </Modal>
  );
}
