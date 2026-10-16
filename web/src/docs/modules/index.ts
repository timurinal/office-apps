/**
 * The Docs modules, in the order they are drawn.
 *
 * Add a module by writing `modules/<name>.tsx` and listing it here. That is the
 * whole seam: the editor reads this array and builds its extensions, ribbon,
 * commands, panes, footer items, File menu and modes from it.
 *
 * The order only breaks ties. Ribbon groups are placed by `tab` and `order`, and
 * footer items and File rows by their own `order`.
 */

import { appearanceModule } from './appearance';
import { desktopDocsModule } from '../../desktop/docsModule';
import { coreModule } from './core';
import { filesModule } from './files';
import { layoutModule } from './layout';
import { menusModule } from './menus';
import { reviewModule } from './review';
import { templatesModule } from './templates';
import type { DocsModule } from './types';

export const DOCS_MODULES: readonly DocsModule[] = [coreModule, layoutModule, reviewModule, templatesModule, menusModule, appearanceModule, filesModule, desktopDocsModule];

export type { DocsContext, DocsModule } from './types';
export { DOCS_TABS } from './types';
