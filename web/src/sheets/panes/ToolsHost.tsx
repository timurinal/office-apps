/**
 * The one overlay the tools share (modules/index.ts lists it): it reads which tool is open
 * (tools.ts) and mounts that tool's dialog, fetched the first time it is wanted. The tools are the
 * dialogs, the filter menu and the find bar; the ribbon, the commands and the keys only ask for
 * them, so none of their code is in the page until somebody uses it.
 *
 * Leaving the spreadsheet closes whatever is open, so the next one does not begin with a dialog.
 */

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { SheetsContext } from '../modules/types';
import { closeFind, useFind } from './findStore';
import { closeTool, useTool } from './tools';

const SortDialog = lazy(() => import('./SortDialog'));
const CfDialog = lazy(() => import('./CfDialog'));
const ValidationDialog = lazy(() => import('./ValidationDialog'));
const DuplicatesDialog = lazy(() => import('./DuplicatesDialog'));
const TextToColumnsDialog = lazy(() => import('./TextToColumnsDialog'));
const InsertFunctionDialog = lazy(() => import('./InsertFunctionDialog'));
const NameManager = lazy(() => import('./NameManager'));
const NumberFormatDialog = lazy(() => import('./NumberFormatDialog'));
const FilterMenu = lazy(() => import('./FilterMenu'));
const FindBar = lazy(() => import('./FindBar'));

export function ToolsHost({ ctx }: { ctx: SheetsContext }) {
  const tool = useTool();
  const find = useFind();
  const latest = useRef(ctx);
  latest.current = ctx;

  // Once opened the find bar stays mounted (and draws nothing when closed), so it can play its exit.
  const [findWas, setFindWas] = useState(false);
  useEffect(() => {
    if (find.open) setFindWas(true);
  }, [find.open]);

  useEffect(
    () => () => {
      closeTool();
      closeFind();
    },
    []
  );

  const seq = tool?.seq;
  const onClose = useCallback(
    (after?: () => void) => {
      if (after) {
        // The dialog has to be gone, and the focus it gives back already given, before `after` takes the keyboard.
        flushSync(() => closeTool(seq));
        after();
      } else closeTool(seq);
    },
    [seq]
  );

  return (
    <Suspense fallback={null}>
      {tool?.id === 'sort' && <SortDialog key={tool.seq} ctx={ctx} onClose={onClose} />}
      {tool?.id === 'cf' && <CfDialog key={tool.seq} ctx={ctx} onClose={onClose} {...(tool.initial ? { initial: tool.initial } : {})} {...(tool.ruleId ? { ruleId: tool.ruleId } : {})} />}
      {tool?.id === 'validation' && <ValidationDialog key={tool.seq} ctx={ctx} onClose={onClose} />}
      {tool?.id === 'duplicates' && <DuplicatesDialog key={tool.seq} ctx={ctx} onClose={onClose} />}
      {tool?.id === 'split' && <TextToColumnsDialog key={tool.seq} ctx={ctx} onClose={onClose} />}
      {tool?.id === 'function' && <InsertFunctionDialog key={tool.seq} ctx={ctx} onClose={onClose} />}
      {tool?.id === 'names' && <NameManager key={tool.seq} ctx={ctx} onClose={onClose} {...(tool.fromSelection ? { fromSelection: true } : {})} />}
      {tool?.id === 'numfmt' && <NumberFormatDialog key={tool.seq} ctx={ctx} onClose={onClose} />}
      {tool?.id === 'filter' && <FilterMenu key={tool.seq} ctx={ctx} onClose={onClose} col={tool.col} />}
      {findWas && <FindBar ctx={ctx} />}
    </Suspense>
  );
}
