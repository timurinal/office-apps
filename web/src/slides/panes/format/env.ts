/** What each tab of the Format pane is handed: the chosen elements and the one way to change them. */

import type { ElementJSON, ThemeJSON } from '../../model/deck';
import type { SlideModel } from '../../model/model';
import type { SlidesContext } from '../../modules/types';
import type { Patches } from './edits';

export interface PaneEnv {
  ctx: SlidesContext;
  model: SlideModel;
  slide: string;
  /** What is chosen on the slide, in the order it was chosen. */
  els: readonly ElementJSON[];
  theme: ThemeJSON;
  /** The deck may be changed: not a reader, not a preview. */
  edit: boolean;
  /** One step for all of the patches: one undo entry, and live for the other person. */
  write: (patches: Patches) => void;
}

export function envWriter(model: SlideModel, slide: string): (patches: Patches) => void {
  return (patches) => {
    if (patches.length) model.updateElements(slide, patches);
  };
}
