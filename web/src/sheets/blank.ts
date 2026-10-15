/**
 * A new, empty spreadsheet's body for `POST /documents`.
 *
 * The room needs a spreadsheet's structure (its sheets, and the row and column ids every cell
 * hangs off) before it can hold one, so a blank one is not "kind and nothing else": it is the
 * model's own blank seed, built here in the page. It is a module of its own so that Home, which
 * makes spreadsheets but never opens one, loads it on the press and not with its first paint
 * (`documents.create` in client.ts, and `prefetchEditor`, which warms it on a pointer).
 */

import type { CreateDocumentRequest } from '@shared/api';
import { buildSheetSeed, sheetSeedRequest } from './model/seed';

export function blankSheetRequest(): Required<Pick<CreateDocumentRequest, 'state' | 'cells'>> {
  return sheetSeedRequest(buildSheetSeed());
}
