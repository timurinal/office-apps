/**
 * The View tab's own: the Guides group, with the smart-guides switch. The rest of the tab is core's
 * (core.tsx): Views, which draws one button per view in `ctx.views` so the slide sorter is there
 * once its module is listed; Show, with Notes; and Zoom, with Fit. The rule the switch turns on and
 * off is `guides.tsx`'s.
 *
 * The switch is a custom item because what it shows is not in the context: it follows
 * `guidesState.ts` itself, as the footer's buttons follow the page.
 */

import { Icon } from '../../core/icons';
import type { RibbonGroup } from '../../core/shell/types';
import { magnetIcon } from './guideIcons';
import { toggleGuides, useGuides } from './guidesState';
import type { SlidesContext, SlidesModule } from './types';

function GuidesSwitch() {
  const on = useGuides();
  return (
    <button
      type="button"
      data-rb-item
      data-id="view.guides"
      className="oa-rb-tl"
      aria-pressed={on}
      title="Smart guides"
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggleGuides}
    >
      <Icon icon={magnetIcon} size={16} />
      Smart guides
    </button>
  );
}

const ribbon: RibbonGroup<SlidesContext>[] = [
  // After Show (200) and before Zoom (300).
  { id: 'view.guides', tab: 'view', order: 250, label: 'Guides', items: [{ type: 'custom', id: 'view.guides', render: () => <GuidesSwitch /> }] }
];

export const viewModule: SlidesModule = { id: 'view', ribbon, commands: [] };
