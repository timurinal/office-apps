/**
 * The Sheets client model. The page makes one `SheetModel` per open
 * workbook, on a `SheetSource`, and hands the grid `model.view(sheetId)`:
 *
 *     const model = new SheetModel(cloudSheetSource(id), { readOnly: role === 'viewer', user });
 *     <Grid data={model.view(sheetId)} onIntent={(i) => applyIntent(model, sheetId, i)} />
 *
 * The ribbon calls the model's methods (`setStyle`, `sort`, `merge`, `insertRows`, `setRule`,
 * …), each of them one step: one undo entry, one frame to the room.
 */

export { SheetModel, LOCAL, cellKey, type ModelNotice, type ModelStatus, type NoticeKind, type SheetInfo, type SheetModelOptions } from './model';
export { SheetView, applyIntent, functionNames, type SelectionState } from './adapter';
export {
  REMOTE,
  cloudSheetSource,
  localSheetSource,
  type LocalSheetSource,
  type SheetConnection,
  type SheetEvents,
  type SheetFile,
  type SheetSource,
  type SourceFeatures
} from './source';
export { buildSheetSeed, sheetSeedRequest, SheetSeedBuilder, SeedSheetBuilder, SheetSeedTooLarge, type SeedCell, type SheetSeed } from './seed';
export {
  FILTER_RANGE,
  filterKey,
  type CfCondition,
  type CfRule,
  type CfStyle,
  type ChartSpec,
  type Comparison,
  type FilterCriterion,
  type ValidationCheck,
  type ValidationRule
} from './features';
export {
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  NEW_SHEET_COLS,
  NEW_SHEET_ROWS,
  registerFeatureRanges,
  mapRanges,
  resolveRect,
  toIdRect,
  type FeatureRanges,
  type IdRect,
  type RangeHolder,
  type StoredName
} from './structure';
export { type StoredStyle } from './styles';
export { type Measure, estimateMeasure } from './measure';
