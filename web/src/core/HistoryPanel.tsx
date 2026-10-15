/**
 * Version history, in the side pane (the shell draws its title and close button).
 *
 * A list grouped by day, newest first. Choosing a version previews it in the
 * page (the page does that: it owns the editor); naming the current state and
 * renaming a named version happen here. Restoring is the page's too, because it
 * is a confirmation over the whole document, so this panel only says which
 * version is chosen.
 */

import { useCallback, useEffect, useState } from 'react';
import type { VersionSummary } from '@shared/api';
import { errorText } from '../api';
import { versions as api } from '../client';
import { Button, IconButton, TextField } from './controls';
import { clockCounterClockwiseIcon, Icon, pencilSimpleIcon, starFillIcon } from './icons';
import { Banner, SkeletonRows, useNotify } from './ui';
import { authorsLine, canRename, groupByDay, timeOfDay, versionTitle } from './versions';

export function HistoryPanel({
  documentId,
  selectedId,
  refreshKey,
  onSelect
}: {
  documentId: string;
  selectedId: string | null;
  /** Bump to reload the list: a restore just made a version. */
  refreshKey: number;
  onSelect: (version: VersionSummary | null) => void;
}) {
  const notify = useNotify();

  const [list, setList] = useState<VersionSummary[] | null>(null);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [naming, setNaming] = useState(false);
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setList((await api.list(documentId)).versions);
      setError('');
    } catch (err) {
      setError(errorText(err, 'Could not load the version history.'));
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const name = async () => {
    const text = label.trim();
    if (!text || naming) return;
    setNaming(true);
    try {
      await api.name(documentId, text);
      setLabel('');
      await load();
    } catch (err) {
      notify({ text: errorText(err, 'Could not name this version.'), tone: 'danger' });
    } finally {
      setNaming(false);
    }
  };

  const rename = async () => {
    if (!editing) return;
    const text = editing.label.trim();
    const id = editing.id;
    setEditing(null);
    if (!text) return;
    try {
      await api.rename(documentId, id, text);
      await load();
    } catch (err) {
      notify({ text: errorText(err, 'Could not rename this version.'), tone: 'danger' });
    }
  };

  const days = list ? groupByDay(list, Math.floor(Date.now() / 1000)) : [];

  return (
    <>
      <div style={{ padding: '14px 14px 4px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <TextField
            aria-label="Name this version"
            placeholder="Name this version"
            size="sm"
            value={label}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void name();
            }}
          />
        </div>
        <Button variant="secondary" size="sm" style={{ height: 32 }} disabled={naming || !label.trim()} onClick={() => void name()}>
          Save
        </Button>
      </div>

      <div className="oa-scroll" style={{ flex: 1, minHeight: 0, padding: '8px 10px 16px' }}>
        {error && (
          <div style={{ padding: '6px 6px' }}>
            <Banner tone="danger">{error}</Banner>
          </div>
        )}
        {!list && !error && (
          <div style={{ padding: '14px 8px' }}>
            <SkeletonRows count={4} />
          </div>
        )}
        {list && list.length === 0 && (
          <p style={{ margin: 16, color: 'var(--fg-3)', fontSize: 14 }}>
            Versions appear here as you edit.
          </p>
        )}

        {days.map((day) => (
          <section key={day.key} aria-label={day.label}>
            <h3
              style={{
                margin: '14px 8px 6px',
                fontFamily: "var(--font-mono), 'JetBrains Mono', monospace",
                fontSize: 10.5,
                fontWeight: 500,
                letterSpacing: '.17em',
                textTransform: 'uppercase',
                color: 'var(--fg-4)'
              }}
            >
              {day.label}
            </h3>
            {day.versions.map((v) => {
              const on = v.id === selectedId;
              const authors = authorsLine(v.authors);
              return (
                <div
                  key={v.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={on}
                  className="oa-row"
                  onClick={() => onSelect(on ? null : v)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(on ? null : v);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '9px 10px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    background: on ? 'var(--app-50)' : undefined
                  }}
                >
                  <span style={{ color: on ? 'var(--app-text)' : 'var(--fg-4)', paddingTop: 2, display: 'inline-flex' }}>
                    <Icon icon={v.kind === 'named' ? starFillIcon : clockCounterClockwiseIcon} size={15} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editing?.id === v.id ? (
                      <div onClick={(e) => e.stopPropagation()}>
                        <TextField
                          aria-label="Version name"
                          size="sm"
                          autoFocus
                          value={editing.label}
                          maxLength={120}
                          onChange={(e) => setEditing({ id: v.id, label: e.target.value })}
                          onBlur={() => void rename()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void rename();
                            if (e.key === 'Escape') setEditing(null);
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        className="oa-ellipsis"
                        style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-1)' }}
                      >
                        {versionTitle(v)}
                      </div>
                    )}
                    <div className="oa-ellipsis" style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
                      {timeOfDay(v.createdAt)}
                      {authors && ` · ${authors}`}
                    </div>
                  </div>
                  {canRename(v) && editing?.id !== v.id && (
                    <span onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        icon={pencilSimpleIcon}
                        label={`Rename ${versionTitle(v)}`}
                        size="sm"
                        onClick={() => setEditing({ id: v.id, label: v.label ?? '' })}
                      />
                    </span>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}
