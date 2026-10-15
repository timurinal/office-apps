/**
 * The deck's layouts, each drawn as a small slide with its placeholders' prompts: what New slide's
 * arrow and the Layout menu open. They are the ribbon's own kind of control (a split button and a
 * menu button), drawn here because a menu of words cannot show a layout.
 */

import { useCallback, useMemo, useState } from 'react';
import { caretDownIcon, Icon, type PhIcon } from '../../core/icons';
import { Popover } from '../../core/ui';
import type { Aspect, LayoutJSON, SlideJSON } from '../model/deck';
import type { Design } from '../model/styles';
import { SlideView } from '../render/SlideView';
import { newSlideElements } from '../themes';

/** CSS px. */
export const LAYOUT_THUMB = 132;

export function LayoutGrid({ design, current, onPick }: { design: Design & { size: Aspect }; current: string | null; onPick: (layoutId: string) => void }) {
  const previews = useMemo(
    () => design.layouts.map((l: LayoutJSON): { layout: LayoutJSON; slide: SlideJSON } => ({ layout: l, slide: { id: `layout-${l.id}`, layout: l.id, elements: newSlideElements(l) } })),
    [design.layouts]
  );
  return (
    <div className="sl-layouts" role="group" aria-label="Layouts">
      {previews.map(({ layout, slide }) => (
        <button
          key={layout.id}
          type="button"
          role="menuitemradio"
          aria-checked={current === layout.id}
          aria-label={layout.name}
          className="sl-layout"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(layout.id)}
        >
          <SlideView design={design} slide={slide} width={LAYOUT_THUMB} mode="edit" />
          <span className="oa-ellipsis">{layout.name}</span>
        </button>
      ))}
    </div>
  );
}

interface ButtonProps {
  id: string;
  label: string;
  icon: PhIcon;
  disabled: boolean;
  design: () => Design & { size: Aspect };
  /** The layout to mark as chosen, read when the gallery opens. */
  current: () => string | null;
  onPick: (layoutId: string) => void;
}

function useOpen() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return { open, setOpen, close };
}

/** New slide: the button adds one in the layout that follows; the arrow chooses the layout. */
export function NewSlideButton(p: ButtonProps & { run: () => void; shortcut?: string }) {
  const o = useOpen();
  return (
    <span className="oa-pop-wrap oa-rb-split">
      <button
        type="button"
        data-rb-item
        data-id={p.id}
        className="oa-rb-tl"
        title={p.shortcut ? `${p.label} (${p.shortcut})` : p.label}
        disabled={p.disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={p.run}
      >
        <Icon icon={p.icon} size={16} />
        {p.label}
      </button>
      <button
        type="button"
        data-rb-item
        data-id={`${p.id}.more`}
        className="oa-rb-chev"
        aria-label={`${p.label}, choose a layout`}
        aria-haspopup="menu"
        aria-expanded={o.open}
        disabled={p.disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => o.setOpen((v) => !v)}
      >
        <Icon icon={caretDownIcon} size={11} />
      </button>
      <Popover open={o.open} onClose={o.close} role="menu" label="New slide">
        <LayoutGrid
          design={p.design()}
          current={null}
          onPick={(id) => {
            o.close();
            p.onPick(id);
          }}
        />
      </Popover>
    </span>
  );
}

/** Layout: the gallery, with the chosen slides' layout marked. */
export function LayoutButton(p: ButtonProps) {
  const o = useOpen();
  return (
    <span className="oa-pop-wrap">
      <button
        type="button"
        data-rb-item
        data-id={p.id}
        className="oa-rb-tl"
        aria-haspopup="menu"
        aria-expanded={o.open}
        disabled={p.disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => o.setOpen((v) => !v)}
      >
        <Icon icon={p.icon} size={16} />
        {p.label}
        <Icon icon={caretDownIcon} size={11} className="oa-rb-cv" />
      </button>
      <Popover open={o.open} onClose={o.close} role="menu" label="Layout">
        <LayoutGrid
          design={p.design()}
          current={p.current()}
          onPick={(id) => {
            o.close();
            p.onPick(id);
          }}
        />
      </Popover>
    </span>
  );
}
