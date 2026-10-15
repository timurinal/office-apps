/**
 * Icons the chart code draws that `core/icons.tsx` and `modules/icons.ts` do not export: Phosphor,
 * regular weight, each its own `?raw` import so a bundle carries only the ones used.
 */

import { ph } from '../../core/icons';

import chartBarHorizontalRaw from '@phosphor-icons/core/assets/regular/chart-bar-horizontal.svg?raw';
import chartBarRaw from '@phosphor-icons/core/assets/regular/chart-bar.svg?raw';
import chartDonutRaw from '@phosphor-icons/core/assets/regular/chart-donut.svg?raw';
import chartLineUpRaw from '@phosphor-icons/core/assets/regular/chart-line-up.svg?raw';
import chartLineRaw from '@phosphor-icons/core/assets/regular/chart-line.svg?raw';
import chartPieRaw from '@phosphor-icons/core/assets/regular/chart-pie.svg?raw';
import chartScatterRaw from '@phosphor-icons/core/assets/regular/chart-scatter.svg?raw';
import downloadSimpleRaw from '@phosphor-icons/core/assets/regular/download-simple.svg?raw';

export const chartBarHorizontalIcon = ph(chartBarHorizontalRaw);
export const chartBarIcon = ph(chartBarRaw);
export const chartDonutIcon = ph(chartDonutRaw);
export const chartLineUpIcon = ph(chartLineUpRaw);
export const chartLineIcon = ph(chartLineRaw);
export const chartPieIcon = ph(chartPieRaw);
export const chartScatterIcon = ph(chartScatterRaw);
export const downloadSimpleIcon = ph(downloadSimpleRaw);
