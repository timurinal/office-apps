/**
 * The icons the Insert, Design and Format modules draw that neither `core/icons.tsx` nor
 * `modules/icons.ts` has. Phosphor, regular weight, each its own `?raw` import so a bundle carries
 * only the ones used (core/icons.tsx says why).
 */

import { ph } from '../../../core/icons';

import arrowUpRightRaw from '@phosphor-icons/core/assets/regular/arrow-up-right.svg?raw';
import arrowsMergeRaw from '@phosphor-icons/core/assets/regular/arrows-merge.svg?raw';
import arrowsSplitRaw from '@phosphor-icons/core/assets/regular/arrows-split.svg?raw';
import chartBarHorizontalRaw from '@phosphor-icons/core/assets/regular/chart-bar-horizontal.svg?raw';
import chartBarRaw from '@phosphor-icons/core/assets/regular/chart-bar.svg?raw';
import chartLineRaw from '@phosphor-icons/core/assets/regular/chart-line.svg?raw';
import chartPieRaw from '@phosphor-icons/core/assets/regular/chart-pie.svg?raw';
import chartScatterRaw from '@phosphor-icons/core/assets/regular/chart-scatter.svg?raw';
import circleRaw from '@phosphor-icons/core/assets/regular/circle.svg?raw';
import columnsPlusLeftRaw from '@phosphor-icons/core/assets/regular/columns-plus-left.svg?raw';
import columnsPlusRightRaw from '@phosphor-icons/core/assets/regular/columns-plus-right.svg?raw';
import columnsRaw from '@phosphor-icons/core/assets/regular/columns.svg?raw';
import imageRaw from '@phosphor-icons/core/assets/regular/image.svg?raw';
import lineSegmentRaw from '@phosphor-icons/core/assets/regular/line-segment.svg?raw';
import paintBucketRaw from '@phosphor-icons/core/assets/regular/paint-bucket.svg?raw';
import paletteRaw from '@phosphor-icons/core/assets/regular/palette.svg?raw';
import rowsPlusBottomRaw from '@phosphor-icons/core/assets/regular/rows-plus-bottom.svg?raw';
import rowsPlusTopRaw from '@phosphor-icons/core/assets/regular/rows-plus-top.svg?raw';
import rowsRaw from '@phosphor-icons/core/assets/regular/rows.svg?raw';
import shapesRaw from '@phosphor-icons/core/assets/regular/shapes.svg?raw';
import slidersHorizontalRaw from '@phosphor-icons/core/assets/regular/sliders-horizontal.svg?raw';
import swatchesRaw from '@phosphor-icons/core/assets/regular/swatches.svg?raw';
import tableRaw from '@phosphor-icons/core/assets/regular/table.svg?raw';

export const arrowUpRightIcon = ph(arrowUpRightRaw);
export const arrowsMergeIcon = ph(arrowsMergeRaw);
export const arrowsSplitIcon = ph(arrowsSplitRaw);
export const chartBarHorizontalIcon = ph(chartBarHorizontalRaw);
export const chartBarIcon = ph(chartBarRaw);
export const chartLineIcon = ph(chartLineRaw);
export const chartPieIcon = ph(chartPieRaw);
export const chartScatterIcon = ph(chartScatterRaw);
export const circleIcon = ph(circleRaw);
export const columnsIcon = ph(columnsRaw);
export const columnsPlusLeftIcon = ph(columnsPlusLeftRaw);
export const columnsPlusRightIcon = ph(columnsPlusRightRaw);
export const imageIcon = ph(imageRaw);
export const lineSegmentIcon = ph(lineSegmentRaw);
export const paintBucketIcon = ph(paintBucketRaw);
export const paletteIcon = ph(paletteRaw);
export const rowsIcon = ph(rowsRaw);
export const rowsPlusBottomIcon = ph(rowsPlusBottomRaw);
export const rowsPlusTopIcon = ph(rowsPlusTopRaw);
export const shapesIcon = ph(shapesRaw);
export const slidersHorizontalIcon = ph(slidersHorizontalRaw);
export const swatchesIcon = ph(swatchesRaw);
export const tableIcon = ph(tableRaw);
