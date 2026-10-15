/**
 * A template card's page, drawn from the template's own content (docs/templates/sketch.ts).
 *
 * The Main board's compact page: 64% of the card, a heading bar in the app's 700, accent
 * bars in its 300 and lines in the soft border. The rows are the sketch's, so a letter is
 * right-aligned lines and a plan is a grid. Colours are `--app-*`, read from the card's
 * `data-app`, as `Thumb`'s are.
 */

import type { CSSProperties } from 'react';
import { TABLE_ROW, type Sketch, type SketchRow } from '../docs/templates/sketch';

const SELF: Record<'center' | 'right', CSSProperties['alignSelf']> = { center: 'center', right: 'flex-end' };

const bar = (height: number, width: number, color: string, align?: 'center' | 'right', extra: CSSProperties = {}): CSSProperties => ({
  height,
  width: `${width}%`,
  flex: 'none',
  borderRadius: 2,
  background: color,
  ...(align ? { alignSelf: SELF[align] } : {}),
  ...extra
});

const SOFT = 'var(--bd-soft)';

function Row({ row, first }: { row: SketchRow; first: boolean }) {
  switch (row.t) {
    case 'title':
      return <div style={bar(7, row.w, 'var(--app-700)', row.align)} />;
    case 'heading':
      return <div style={bar(5, row.w, 'var(--app-300)', row.align, { marginTop: first ? 0 : 4 })} />;
    case 'line':
      return <div style={bar(4, row.w, SOFT, row.align)} />;
    case 'rule':
      return <div style={bar(1, 100, 'var(--bd)')} />;
    case 'quote':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, height: 4, paddingLeft: 2, boxShadow: 'inset 2px 0 0 var(--app-300)' }}>
          <div style={bar(4, row.w, SOFT)} />
        </div>
      );
    case 'item':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 4, flex: 'none' }}>
          {row.mark === 'dot' && <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--app-300)', flex: 'none' }} />}
          {row.mark === 'box' && <span style={{ width: 4, height: 4, borderRadius: 1, boxShadow: 'inset 0 0 0 1px var(--app-300)', flex: 'none' }} />}
          {row.mark === 'number' && <span style={{ width: 5, height: 3, borderRadius: 1, background: 'var(--app-300)', flex: 'none' }} />}
          <div style={bar(4, row.w, SOFT)} />
        </div>
      );
    case 'table':
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${row.cols}, 1fr)`,
            flex: 'none',
            boxShadow: `0 0 0 1px ${SOFT}`,
            borderRadius: 1,
            overflow: 'hidden'
          }}
        >
          {Array.from({ length: row.rows * row.cols }, (_, i) => (
            <span
              key={i}
              style={{
                height: TABLE_ROW,
                background: row.header && i < row.cols ? 'var(--app-200)' : 'transparent',
                boxShadow: `inset -1px -1px 0 ${SOFT}`
              }}
            />
          ))}
        </div>
      );
  }
}

export function SketchThumb({ sketch }: { sketch: Sketch }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: sketch.wide ? '86%' : '64%',
        height: '100%',
        boxSizing: 'border-box',
        padding: '16px 4px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }}
    >
      {sketch.rows.map((row, i) => (
        <Row key={i} row={row} first={i === 0} />
      ))}
    </div>
  );
}
