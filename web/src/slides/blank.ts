/**
 * A new, empty presentation's body for `POST /documents`: the default theme's deck with one title
 * slide, as the update a room applies. A module of its own, like Sheets' (sheets/blank.ts), so
 * Home loads the themes on the press and not with its first paint (`documents.create` in client.ts).
 */

import type { CreateDocumentRequest } from '@shared/api';
import { toBase64 } from '../crypto/primitives';
import { deckToY } from './model/ydoc';
import { blankDeck } from './themes';

export function blankDeckRequest(themeId?: string): Required<Pick<CreateDocumentRequest, 'state'>> {
  return { state: toBase64(deckToY(blankDeck(themeId))) };
}
