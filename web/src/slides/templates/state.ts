/**
 * A Slides template as the create call's `state`: its deck written into a new document's Yjs
 * state. The heavy half of making one (the model's Yjs writer), loaded when a card is pressed and
 * not with Home, as `docs/templates/state.ts` is for Docs.
 */

import { toBase64 } from '../../crypto/primitives';
import { deckToY } from '../model/ydoc';
import type { SlidesTemplate } from './types';

export const slidesTemplateBase64 = (t: SlidesTemplate): string => toBase64(deckToY(t.deck()));
