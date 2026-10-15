/**
 * Icons the smart-guides and View modules draw that `core/icons.tsx` and `modules/icons.ts`
 * do not export. Phosphor, regular weight, each its own `?raw` import so a bundle carries only the
 * ones used.
 */

import { ph } from '../../core/icons';

import magnetRaw from '@phosphor-icons/core/assets/regular/magnet.svg?raw';

export const magnetIcon = ph(magnetRaw);
