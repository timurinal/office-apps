/**
 * Where a slide's pictures come from. The editor provides the document's assets route; a page
 * without one (a preview of an imported deck) draws only pictures that are still inline.
 */

import { createContext, useContext } from 'react';
import { PATHS } from '@shared/api';

export type AssetUrl = (assetId: string) => string | null;

const none: AssetUrl = () => null;

export const SlideAssets = createContext<AssetUrl>(none);

export const useAssetUrl = (): AssetUrl => useContext(SlideAssets);

/** The assets route of one document. */
export const documentAssets = (docId: string): AssetUrl => (assetId) => PATHS.asset(docId, assetId);
