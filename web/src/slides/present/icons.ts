/**
 * Icons the slide show draws that neither `core/icons.tsx` nor `modules/icons.ts` has. Phosphor,
 * regular weight, each its own `?raw` import so a bundle carries only the ones used.
 */

import { ph } from '../../core/icons';

import arrowClockwiseRaw from '@phosphor-icons/core/assets/regular/arrow-clockwise.svg?raw';
import arrowsOutCardinalRaw from '@phosphor-icons/core/assets/regular/arrows-out-cardinal.svg?raw';
import arrowsOutSimpleRaw from '@phosphor-icons/core/assets/regular/arrows-out-simple.svg?raw';
import circleHalfRaw from '@phosphor-icons/core/assets/regular/circle-half.svg?raw';
import cursorRaw from '@phosphor-icons/core/assets/regular/cursor.svg?raw';
import monitorPlayRaw from '@phosphor-icons/core/assets/regular/monitor-play.svg?raw';
import pauseRaw from '@phosphor-icons/core/assets/regular/pause.svg?raw';
import stopRaw from '@phosphor-icons/core/assets/regular/stop.svg?raw';
import timerRaw from '@phosphor-icons/core/assets/regular/timer.svg?raw';

export const arrowClockwiseIcon = ph(arrowClockwiseRaw);
export const arrowsOutCardinalIcon = ph(arrowsOutCardinalRaw);
export const arrowsOutSimpleIcon = ph(arrowsOutSimpleRaw);
export const circleHalfIcon = ph(circleHalfRaw);
export const cursorIcon = ph(cursorRaw);
export const monitorPlayIcon = ph(monitorPlayRaw);
export const pauseIcon = ph(pauseRaw);
export const stopIcon = ph(stopRaw);
export const timerIcon = ph(timerRaw);
