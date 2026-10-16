/**
 * A colour control: a swatch with the colour's name, and a panel of the theme's colours with their
 * tints and shades, ten standard ones, the ones chosen last, and a hex field and the browser's own
 * picker for any other. A colour that is picked is the person's: it goes to the recent list.
 *
 * Two modes. `theme` stores what is chosen as a theme slot (and so follows a theme change), which is
 * what a fill and an outline do. `hex` stores the colour the theme makes it today, which is what type
 * does (a run's mark holds `#rrggbb`, as the ribbon's font colour does).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { caretDownIcon, Icon } from '../../../core/icons';
import type { Color, ThemeJSON } from '../../model/deck';
import { resolveColor } from '../../model/color';
import { FloatPanel } from './FloatPanel';
import { describeColor, parseHex, resolved, sameColor, STANDARD, themeGrid, type Choice } from './palette';
import { pushRecent, readRecent } from './recent';

export interface ColorPickerProps {
  /** What the control is for: "Fill colour". Its accessible name. */
  label: string;
  /** The colour showing, or null for none or for a selection that differs. */
  value: Color | null;
  /** Shown beside the swatch when `value` is null: "Mixed", "No fill". */
  empty?: string;
  theme: ThemeJSON;
  mode?: 'theme' | 'hex';
  onPick: (color: Color) => void;
  /** One more choice above the palette: "Automatic", "No fill". */
  clear?: { label: string; run: () => void };
  disabled?: boolean;
}

const GRID = themeGrid();

export function ColorPicker({ label, value, empty = 'None', theme, mode = 'theme', onPick, clear, disabled }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  const choose = (c: Color) => {
    setOpen(false);
    onPick(c);
  };
  const css = value ? resolveColor(value, theme) : null;

  return (
    <>
      <button
        ref={button}
        type="button"
        className="sl-cp"
        aria-label={`${label}${value ? `, ${describeColor(value)}` : `, ${empty.toLowerCase()}`}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sl-cp-swatch" data-empty={css ? undefined : ''} style={css ? { background: css } : undefined} />
        <span className="sl-cp-name">{value ? describeColor(value) || css : empty}</span>
        <Icon icon={caretDownIcon} size={11} className="sl-cp-caret" />
      </button>
      <FloatPanel anchor={button} open={open} onClose={() => setOpen(false)} label={label}>
        <ColorPanel
          value={value}
          theme={theme}
          mode={mode}
          {...(clear ? { clear: { label: clear.label, run: () => (setOpen(false), clear.run()) } } : {})}
          onPick={choose}
        />
      </FloatPanel>
    </>
  );
}


/**
 * The panel of colours itself: the theme's, their tints and shades, ten standard ones, the ones
 * chosen last and a hex field. It is the picker's popover, and the Design tab's background menu
 * carries it too. `onPick` is told the colour as the mode stores it.
 */
export function ColorPanel({
  value,
  theme,
  mode = 'theme',
  onPick,
  clear
}: {
  value: Color | null;
  theme: ThemeJSON;
  mode?: 'theme' | 'hex';
  onPick: (color: Color) => void;
  clear?: { label: string; run: () => void };
}) {
  const [recent, setRecent] = useState<Color[]>(() => readRecent());
  const css = value ? resolveColor(value, theme) : null;
  const choose = (c: Color) => {
    const color = mode === 'hex' ? resolved(c, theme) : c;
    setRecent(pushRecent(color));
    onPick(color);
  };
  return (
    <div className="sl-cp-panel">
      {clear && (
        <button type="button" className="oa-menu-item" onClick={clear.run}>
          <span className="oa-menu-label">{clear.label}</span>
        </button>
      )}
      <span className="sl-cp-title">Theme colours</span>
      <div className="sl-cp-grid" role="group" aria-label="Theme colours">
        {GRID.map((row, r) => row.map((c, i) => <Swatch key={`${r}.${i}`} choice={c} theme={theme} current={value} onPick={choose} />))}
      </div>
      <span className="sl-cp-title">Standard colours</span>
      <div className="sl-cp-grid" role="group" aria-label="Standard colours">
        {STANDARD.map((c) => (
          <Swatch key={c.label} choice={c} theme={theme} current={value} onPick={choose} />
        ))}
      </div>
      {recent.length > 0 && (
        <>
          <span className="sl-cp-title">Recent</span>
          <div className="sl-cp-grid" role="group" aria-label="Recent colours">
            {recent.map((c, i) => (
              <Swatch key={`${i}`} choice={{ color: c, label: describeColor(c) }} theme={theme} current={value} onPick={choose} />
            ))}
          </div>
        </>
      )}
      <HexField current={css} onPick={choose} />
    </div>
  );
}

function Swatch({ choice, theme, current, onPick }: { choice: Choice; theme: ThemeJSON; current: Color | null; onPick: (c: Color) => void }) {
  const css = resolveColor(choice.color, theme) ?? '#000000';
  return (
    <button
      type="button"
      className="sl-cp-chip"
      aria-label={choice.label}
      title={choice.label}
      aria-pressed={sameColor(choice.color, current) || (typeof current === 'string' && css === current)}
      style={{ background: css }}
      onClick={() => onPick(choice.color)}
    />
  );
}

/** Any other colour: a hex field that takes it on Enter or when it is left, and the browser's own picker. */
function HexField({ current, onPick }: { current: string | null; onPick: (c: Color) => void }) {
  const [draft, setDraft] = useState(current ?? '');
  const [bad, setBad] = useState(false);
  const native = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(current ?? ''), [current]);

  const commit = () => {
    const hex = parseHex(draft);
    if (!hex) {
      setBad(draft.trim() !== '');
      return;
    }
    setBad(false);
    if (hex !== current) onPick(hex);
  };

  // The browser's picker fires `change` only when it is dismissed, so dragging in it is not a step apiece.
  const latest = useRef(onPick);
  latest.current = onPick;
  useEffect(() => {
    const el = native.current;
    if (!el) return;
    const done = () => latest.current(el.value.toLowerCase());
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, []);

  const shown = useMemo(() => parseHex(draft) ?? '#000000', [draft]);
  return (
    <div className="sl-cp-hex">
      <input ref={native} type="color" aria-label="Pick a colour" value={shown} onChange={(e) => setDraft(e.target.value)} />
      <input
        type="text"
        aria-label="Hex colour"
        aria-invalid={bad || undefined}
        spellCheck={false}
        autoComplete="off"
        placeholder="#rrggbb"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setBad(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
    </div>
  );
}
