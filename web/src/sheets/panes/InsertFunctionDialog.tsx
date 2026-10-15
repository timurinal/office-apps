/**
 * Insert function: every function the engine has, searchable by name and by what it does, with its
 * arguments explained. Choosing one starts the formula in the active cell (or puts the call at the
 * caret of a formula being typed), and the person fills in the arguments in the cell.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Select, TextField } from '../../core/controls';
import { magnifyingGlassIcon } from '../../core/icons';
import { Modal, useModalClose } from '../../core/ui';
import { functionNames } from '../model';
import { insertFunction } from '../modules/formulaActions';
import { CATEGORY_ORDER, FUNCTION_HELP } from './functionHelp';
import { Actions, type ToolProps } from './parts';

const OTHER = 'Other';
const SHOWN = 300;

interface Row {
  name: string;
  category: string;
  text: string;
}

function Insert({ name, onInsert }: { name: string | null; onInsert: (name: string) => void }) {
  const close = useModalClose();
  return (
    <Actions>
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
      <Button
        variant="primary"
        disabled={!name}
        onClick={() => {
          if (!name) return;
          onInsert(name);
          close();
        }}
      >
        Insert
      </Button>
    </Actions>
  );
}

/** The search, the list and the help: inside the dialog, so that choosing can close it with its exit. */
function Content({ onChosen, onInsert }: { onChosen: (name: string | null) => void; onInsert: (name: string) => void }) {
  const close = useModalClose();
  const rows = useMemo<Row[]>(
    () =>
      functionNames().map((name) => {
        const h = FUNCTION_HELP.get(name);
        return { name, category: h?.category ?? OTHER, text: h?.text ?? '' };
      }),
    []
  );
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [name, setName] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inCategory = rows.filter((r) => category === 'All' || r.category === category);
    if (!q) return inCategory;
    // Names that start with the text first, then names that contain it, then what the help says.
    const rank = (r: Row) => (r.name.toLowerCase().startsWith(q) ? 0 : r.name.toLowerCase().includes(q) ? 1 : r.text.toLowerCase().includes(q) ? 2 : 3);
    return inCategory.filter((r) => rank(r) < 3).sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : 1));
  }, [rows, query, category]);

  // The first result is the one chosen until a person chooses another.
  const now = found.some((r) => r.name === name) ? name : (found[0]?.name ?? null);
  useEffect(() => onChosen(now), [now, onChosen]);
  const help = now ? FUNCTION_HELP.get(now) : undefined;

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [now]);

  const step = (d: 1 | -1) => {
    const at = found.findIndex((r) => r.name === now);
    const next = found[Math.max(0, Math.min(found.length - 1, at + d))];
    if (next) setName(next.name);
  };
  const choose = (n: string) => {
    onInsert(n);
    close();
  };

  return (
    <div className="sx-fn">
      <div className="sx-fn-left">
        <TextField
          aria-label="Search functions"
          placeholder="Search by name or by what it does"
          icon={magnifyingGlassIcon}
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              step(1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              step(-1);
            } else if (e.key === 'Enter' && now) {
              e.preventDefault();
              choose(now);
            }
          }}
        />
        <Select aria-label="Category" value={category} options={['All', ...CATEGORY_ORDER, OTHER].map((c) => ({ value: c, label: c }))} onChange={setCategory} />
        <div className="sx-list" ref={list} role="listbox" aria-label="Functions">
          {found.slice(0, SHOWN).map((r) => (
            <button key={r.name} type="button" role="option" aria-selected={r.name === now} className="sx-list-row sx-mono" onClick={() => setName(r.name)} onDoubleClick={() => choose(r.name)}>
              <span className="sx-grow">{r.name}</span>
            </button>
          ))}
          {found.length > SHOWN && <p className="sx-note" style={{ padding: '8px 12px' }}>{(found.length - SHOWN).toLocaleString('en-GB')} more. Search to narrow them.</p>}
          {found.length === 0 && <p className="sx-note" style={{ padding: '8px 12px' }}>No function matches.</p>}
        </div>
      </div>

      <div className="sx-fn-right" aria-live="polite">
        {now && (
          <>
            <div className="sx-fn-sig">{help?.signature ?? `${now}(…)`}</div>
            <p className="sx-note" style={{ color: 'var(--fg-2)', fontSize: 13.5 }}>
              {help?.text ?? 'There is no description of this function yet.'}
            </p>
            {help && help.args.length > 0 && (
              <>
                <h3 className="sx-heading">Arguments</h3>
                {help.args.map((a) => (
                  <div className="sx-fn-arg" key={a.name}>
                    <b>
                      {a.name}
                      {a.optional && <span className="sx-dim"> optional</span>}
                    </b>
                    <span className="sx-note">{a.text}</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function InsertFunctionDialog({ ctx, onClose }: ToolProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  const after = useRef<(() => void) | null>(null);
  const insert = (n: string) => {
    after.current = () => insertFunction(ctx, n);
  };
  return (
    <Modal title="Insert function" width={720} onClose={() => onClose(after.current ?? undefined)} footer={<Insert name={chosen} onInsert={insert} />}>
      <Content onChosen={setChosen} onInsert={insert} />
    </Modal>
  );
}
