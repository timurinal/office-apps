/** Drawing a slide: the static renderer, its thumbnails and the pieces the editor shares with it. */

export { SlideView, ElementView, renderCtx, backdropOf, slideHeight, type SlideViewProps, type RenderCtx, type RenderMode } from './SlideView';
export { Thumbnail, type ThumbnailProps } from './Thumbnail';
export { TextFrame, Paragraphs, shrinkOf, shrinkKey } from './Text';
export { SlideAssets, useAssetUrl, documentAssets, type AssetUrl } from './assets';
export { shapePath, dashArray, lineEnds, SHAPE_KINDS, ROUND_RECT_DEFAULT, type ShapePath } from './geometry';
export { paragraphCss, bulletCss, runCss, insetsOf, anchorCss, fontStack, cssText, reactStyle, backgroundCss, pictureUrl, DEFAULT_INSETS, type Css } from './paint';
