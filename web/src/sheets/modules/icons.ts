/**
 * Icons the Sheets modules draw that `web/src/core/icons.tsx` (the shell's) does not export.
 * Phosphor, regular weight, each its own `?raw` import so a bundle carries only the ones used
 * (see that file). Other Sheets modules import from here too, so a name that core.tsx does not
 * use may still be somebody else's: look before removing one.
 */

import { ph } from '../../core/icons';

import columnsPlusLeftRaw from '@phosphor-icons/core/assets/regular/columns-plus-left.svg?raw';
import columnsPlusRightRaw from '@phosphor-icons/core/assets/regular/columns-plus-right.svg?raw';
import gridFourRaw from '@phosphor-icons/core/assets/regular/grid-four.svg?raw';
import magnifyingGlassMinusRaw from '@phosphor-icons/core/assets/regular/magnifying-glass-minus.svg?raw';
import magnifyingGlassPlusRaw from '@phosphor-icons/core/assets/regular/magnifying-glass-plus.svg?raw';
import rowsPlusBottomRaw from '@phosphor-icons/core/assets/regular/rows-plus-bottom.svg?raw';
import rowsPlusTopRaw from '@phosphor-icons/core/assets/regular/rows-plus-top.svg?raw';
import scissorsRaw from '@phosphor-icons/core/assets/regular/scissors.svg?raw';
import sigmaRaw from '@phosphor-icons/core/assets/regular/sigma.svg?raw';
import snowflakeRaw from '@phosphor-icons/core/assets/regular/snowflake.svg?raw';

export const columnsPlusLeftIcon = ph(columnsPlusLeftRaw);
export const columnsPlusRightIcon = ph(columnsPlusRightRaw);
export const gridFourIcon = ph(gridFourRaw);
export const magnifyingGlassMinusIcon = ph(magnifyingGlassMinusRaw);
export const magnifyingGlassPlusIcon = ph(magnifyingGlassPlusRaw);
export const rowsPlusBottomIcon = ph(rowsPlusBottomRaw);
export const rowsPlusTopIcon = ph(rowsPlusTopRaw);
export const scissorsIcon = ph(scissorsRaw);
export const sigmaIcon = ph(sigmaRaw);
export const snowflakeIcon = ph(snowflakeRaw);
