/**
 * The header's Present button, as the design draws it: Present, and a chevron that opens the other
 * ways to start. The button starts from the current slide (the same as Shift+F5); the menu has
 * From beginning, From current slide and Presenter view.
 */

import { Button } from '../../core/controls';
import { caretDownIcon, Icon } from '../../core/icons';
import { Menu } from '../../core/ui';
import { playIcon } from '../modules/icons';
import type { SlidesContext } from '../modules/types';
import { monitorPlayIcon } from './icons';
import { startPresenterView } from './start';
import './present.css';

export function PresentMenu({ ctx, disabled = false }: { ctx: SlidesContext | null; disabled?: boolean }) {
  const off = disabled || !ctx;
  const from = ctx ? Math.max(0, ctx.slideIndex) : 0;
  return (
    <span className="sp-split">
      <Button variant="secondary" icon={playIcon} className="sl-present" title="Present from this slide" disabled={off} onClick={() => ctx?.present(from)}>
        Present
      </Button>
      <Menu
        label="Ways to present"
        icon={caretDownIcon}
        items={
          ctx
            ? [
                { label: 'From beginning', icon: playIcon, shortcut: 'F5', onSelect: () => ctx.present(0) },
                { label: 'From current slide', icon: playIcon, shortcut: 'Shift+F5', onSelect: () => ctx.present(from) },
                { label: 'Presenter view', icon: monitorPlayIcon, separated: true, onSelect: () => startPresenterView(ctx) }
              ]
            : []
        }
        trigger={({ open, toggle, ref }) => (
          <Button ref={ref} variant="secondary" className="sl-present" aria-label="Ways to present" aria-haspopup="menu" aria-expanded={open} disabled={off} onClick={toggle}>
            <Icon icon={caretDownIcon} size={12} />
          </Button>
        )}
      />
    </span>
  );
}
