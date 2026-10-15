/**
 * The Slides model: what the editor, the renderer, the modules and the converters import.
 * ydoc.ts is the only code that knows the Yjs layout; everything else goes through here.
 */

export * from './deck';
export { newId } from './ids';
export { safeColor, safeFill, safeLine, safeBullet, safeFamily, safePt, safeAssetId, THEME_SLOTS } from './safe';
export { tint, slotColor, resolveColor, themeVars, cssColorVar, luminance } from './color';
export {
  MAX_LEVEL,
  ALIGNS,
  LINE_FACTOR,
  paraAttrs,
  paraCss,
  slideTextExtensions,
  slideSchema,
  textNode,
  emptyText,
  plainTextDoc,
  plainText,
  isEmptyText,
  TextInvalid,
  type Align,
  type ParaAttrs
} from './schema';
export {
  inheritedStyle,
  paragraphStyle,
  layoutById,
  layoutPlaceholder,
  styleKind,
  bulletLabels,
  numberLabel,
  parasOf,
  type Design,
  type ResolvedStyle,
  type BulletLabel,
  type StyleKind
} from './styles';
export {
  deckToY,
  yToDeck,
  writeDeck,
  readText,
  writeText,
  aspectOf,
  heightOf,
  countElements,
  DeckInvalid,
  DeckTooLarge,
  FALLBACK_THEME,
  FALLBACK_MASTER,
  type WriteOptions
} from './ydoc';
export {
  SlideModel,
  StepOrigin,
  FIXUP,
  FOOTER_TYPES,
  MESSAGES,
  TYPING_MERGE_MS,
  boundsOf,
  unionOf,
  withoutIds,
  placeholderCopies,
  translated,
  arranged,
  type DeckChange,
  type ElementPatch,
  type SlidePatch,
  type ZMove,
  type Box,
  type Located,
  type ModelNotice,
  type NoticeKind,
  type SlideModelOptions
} from './model';
