/**
 * What a document looks like on Home: a small drawing of its kind, in the kind's colour.
 *
 * Office keeps no preview image of a document, and drawing one would mean opening
 * every document's content for a list, so the thumbnail is the kind's own mark: a
 * page with a heading and lines, a grid with a header band, a slide. They are the
 * Main board's, and they read `--app-*` from the nearest `data-app`, so a Docs card
 * is blue and a Sheets card is green without knowing it.
 */

import type { DocKind } from '@shared/api';
import { Icon, fileTextIcon, lockSimpleIcon, plusIcon, presentationChartIcon, tableIcon, type PhIcon } from '../core/icons';

export const KIND_GLYPH: Record<DocKind, PhIcon> = {
  docs: fileTextIcon,
  sheets: tableIcon,
  slides: presentationChartIcon
};

const bar = (width: string, color: string, height = 4, extra: React.CSSProperties = {}): React.ReactElement => (
  <div style={{ height, width, borderRadius: 2, background: color, ...extra }} />
);

/** A page: a heading bar and lines of text. */
function Page({ compact }: { compact: boolean }) {
  return (
    <div
      style={
        compact
          ? { width: '64%', height: '100%', padding: '16px 4px 0', display: 'flex', flexDirection: 'column', gap: 6 }
          : {
              width: '60%',
              height: 112,
              padding: '14px 12px 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              background: 'var(--paper)',
              borderRadius: '4px 4px 0 0',
              boxShadow: '0 1px 2px rgba(40,28,45,0.06)'
            }
      }
    >
      {bar(compact ? '58%' : '55%', 'var(--app-700)', 7)}
      {bar('100%', 'var(--bd-soft)')}
      {bar(compact ? '92%' : '94%', 'var(--bd-soft)')}
      {bar(compact ? '97%' : '98%', 'var(--bd-soft)')}
      {compact ? bar('36%', 'var(--app-300)', 5, { marginTop: 4 }) : bar('70%', 'var(--bd-soft)')}
      {bar('100%', 'var(--bd-soft)', 4, { marginTop: compact ? 0 : 4 })}
      {bar(compact ? '80%' : '88%', 'var(--bd-soft)')}
    </div>
  );
}

/** A grid with a header band, and in a card the cell that is selected. */
function Sheet({ compact }: { compact: boolean }) {
  const cell = compact ? '28px 12px' : '30px 13px';
  return (
    <div
      style={{
        width: '78%',
        height: compact ? 74 : 108,
        borderRadius: compact ? 3 : '4px 4px 0 0',
        backgroundColor: 'var(--paper)',
        backgroundImage: 'linear-gradient(var(--bd-soft) 1px, transparent 1px), linear-gradient(90deg, var(--bd-soft) 1px, transparent 1px)',
        backgroundSize: cell,
        boxShadow: compact ? '0 0 0 1px var(--bd-soft)' : '0 1px 2px rgba(40,28,45,0.06)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div style={{ height: compact ? 12 : 13, background: 'var(--app-200)' }} />
      {!compact && (
        <div style={{ margin: '20px 0 0 62px', width: 56, height: 13, border: '2px solid var(--app-600)' }} />
      )}
    </div>
  );
}

/** A slide: the deck's own colour (violet, whatever app it is in) with a title and a line. */
function Slide({ compact }: { compact: boolean }) {
  return (
    <div
      style={{
        width: compact ? '78%' : '80%',
        aspectRatio: '16 / 9',
        marginBottom: compact ? 0 : 14,
        borderRadius: 6,
        background: 'var(--accent-800)',
        padding: compact ? 12 : 14,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap: compact ? 5 : 6
      }}
    >
      {bar('62%', 'var(--accent-100)', compact ? 8 : 9)}
      {bar('40%', 'var(--accent-400)', compact ? 4 : 5)}
    </div>
  );
}

/**
 * `variant` is where it sits: a `template` card shows the drawing small on white; a
 * `recent` card shows it larger on the grey, standing on the card's lower edge.
 */
export function Thumb({
  kind,
  variant,
  blank = false,
  locked = false
}: {
  kind: DocKind;
  variant: 'template' | 'recent';
  blank?: boolean;
  locked?: boolean;
}) {
  const compact = variant === 'template';
  if (blank) {
    return (
      <span className="oa-tile" style={{ width: 40, height: 40, borderRadius: 10 }}>
        <Icon icon={plusIcon} size={20} />
      </span>
    );
  }
  if (locked) {
    return (
      <span className="oa-tile" style={{ width: 44, height: 44, borderRadius: 12, alignSelf: 'center' }}>
        <Icon icon={lockSimpleIcon} size={22} />
      </span>
    );
  }
  return kind === 'docs' ? <Page compact={compact} /> : kind === 'sheets' ? <Sheet compact={compact} /> : <Slide compact={compact} />;
}
