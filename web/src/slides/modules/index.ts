/**
 * The Slides modules, in the order they are drawn.
 *
 * Add a module by writing it and listing it here. That is the whole seam: the editor reads this
 * array and builds its ribbon, commands, keys, panes, footer items, File menu, modes, overlays,
 * canvas layers, snap rules, views and slide show from it. The order only breaks ties (and picks
 * the first snap rule that answers); ribbon groups are placed by `tab` and `order` (see types.ts
 * for the slots), and footer items and File rows by their own `order`.
 */

import { appearanceModule } from './appearance';
import { coreModule } from './core';
import { insertModule } from './insert';
import { designModule } from './design';
import { formatModule } from './format';
import { viewModule } from './view';
import { findModule } from './find';
import { sorterModule } from './sorter';
import { guidesModule } from './guides';
import { arrangeModule } from './arrange';
import { menusModule } from './menus';
import { slideshowModule } from './slideshow';
import { transitionsModule } from './transitions';
import { filesModule } from './files';
import type { SlidesModule } from './types';

export const SLIDES_MODULES: readonly SlidesModule[] = [coreModule, insertModule, designModule, formatModule, arrangeModule, guidesModule, sorterModule, findModule, viewModule, slideshowModule, transitionsModule, menusModule, appearanceModule, filesModule];

export type { SlidesContext, SlidesModule } from './types';
export { SLIDES_TABS } from './types';
