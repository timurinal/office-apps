/**
 * "Search or run a command", the box in the header. Ctrl+K (or Cmd+K) focuses it
 * from anywhere.
 *
 * It searches what the screen registered as commands and, where it is asked to
 * (Home), the reader's documents through the list API's `q`. A command is ranked by
 * how well its title starts with what was typed (registry.ts `scoreText`); a
 * document by the server's order. Arrow keys move, Enter runs, Escape puts it away.
 *
 * It is a combobox: the input owns focus the whole time and names the highlighted
 * row with `aria-activedescendant`, so a screen reader hears the row without focus
 * ever leaving the field.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DocumentSummary } from '@shared/api';
import { documents as documentsApi } from '../../client';
import { docPath } from '../../home/home';
import { useRouter } from '../../router';
import { formatWhen } from '../../theme';
import { Icon, magnifyingGlassIcon, fileTextIcon, tableIcon, presentationChartIcon } from '../icons';
import { Popover } from '../ui';
import { mod } from '../keys';
import { searchCommands } from '../shell/registry';
import type { Command } from '../shell/types';

const KIND_GLYPH = { docs: fileTextIcon, sheets: tableIcon, slides: presentationChartIcon } as const;

type Row<C> =
  | { type: 'command'; id: string; command: Command<C> }
  | { type: 'document'; id: string; doc: DocumentSummary };



export function CommandSearch<C>({
  commands,
  ctx,
  withDocuments = false,
  onRan
}: {
  commands: readonly Command<C>[];
  ctx: C;
  /** Also search the reader's documents, and open the one chosen. */
  withDocuments?: boolean;
  /** Called after a command has run. The editor puts the caret back. */
  onRan?: () => void;
}) {
  const { navigate } = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState<DocumentSummary[]>([]);

  // In the page Ctrl+K is Insert link, and the box answers Ctrl+/ (docs/core/keys.ts), so the
  // hint says the key that works where the caret is. In Sheets' grid both work; Ctrl+/ is what
  // the grid's own keys document (sheets/keys.ts), so that is the hint there.
  const [inPage, setInPage] = useState(false);
  useEffect(() => {
    const track = (e: FocusEvent) =>
      setInPage(e.type === 'focusin' && e.target instanceof Element && e.target.closest('.ProseMirror[contenteditable="true"], .sg-root') !== null);
    document.addEventListener('focusin', track);
    document.addEventListener('focusout', track);
    return () => {
      document.removeEventListener('focusin', track);
      document.removeEventListener('focusout', track);
    };
  }, []);

  // Ctrl+K from anywhere on the page.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  // Documents wait for the typing to pause, and the newest answer wins.
  useEffect(() => {
    if (!withDocuments || !open || !query.trim()) {
      setDocs([]);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      documentsApi
        .list({ view: 'recent', q: query.trim(), limit: 5 })
        .then((r) => live && setDocs(r.documents))
        .catch(() => live && setDocs([]));
    }, 150);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query, open, withDocuments]);

  const rows = useMemo<Row<C>[]>(() => {
    const out: Row<C>[] = searchCommands(commands, query, ctx, query.trim() ? 8 : 10).map((c) => ({
      type: 'command',
      id: `c:${c.id}`,
      command: c
    }));
    for (const d of docs) out.push({ type: 'document', id: `d:${d.id}`, doc: d });
    return out;
  }, [commands, query, ctx, docs]);

  useEffect(() => setActive(0), [query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    input.current?.blur();
  }, []);

  const choose = (row: Row<C> | undefined) => {
    if (!row) return;
    close();
    if (row.type === 'document') {
      navigate(docPath(row.doc.kind, row.doc.id));
      return;
    }
    if (row.command.disabled?.(ctx)) return;
    row.command.run(ctx);
    onRan?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (rows.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(rows[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  let lastSection = '';
  return (
    <span className="oa-pop-wrap oa-search-wrap">
      <label className="oa-search">
        <Icon icon={magnifyingGlassIcon} size={15} />
        <input
          ref={input}
          role="combobox"
          aria-label="Search or run a command"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
          placeholder="Search or run a command"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd>{inPage ? mod('/') : mod('K')}</kbd>
      </label>
      <Popover open={open} onClose={() => setOpen(false)} align="left" className="oa-search-pop">
        <div id={listId} role="listbox" aria-label="Results">
          {rows.length === 0 && <div className="oa-search-empty">{query.trim() ? 'Nothing matches that.' : 'Type to search.'}</div>}
          {rows.map((row, i) => {
            const section = row.type === 'document' ? 'Documents' : row.command.section;
            const head = section !== lastSection;
            lastSection = section;
            return (
              <div key={row.id}>
                {head && <div className="oa-search-section">{section}</div>}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={row.type === 'command' ? (row.command.disabled?.(ctx) ?? false) : undefined}
                  className="oa-search-row"
                  data-active={i === active ? 'true' : undefined}
                  // A press must not blur the input before the click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(row)}
                >
                  {row.type === 'document' ? (
                    <>
                      <Icon icon={KIND_GLYPH[row.doc.kind]} size={16} />
                      <span className="oa-ellipsis oa-search-title">{row.doc.title}</span>
                      <span className="oa-search-meta">{formatWhen(row.doc.updatedAt)}</span>
                    </>
                  ) : (
                    <>
                      {row.command.icon ? <Icon icon={row.command.icon} size={16} /> : <span style={{ width: 16 }} />}
                      <span className="oa-ellipsis oa-search-title">{row.command.title}</span>
                      {row.command.shortcut && <kbd className="oa-search-meta">{row.command.shortcut}</kbd>}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Popover>
    </span>
  );
}
