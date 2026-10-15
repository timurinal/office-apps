/**
 * The name manager: every defined name with what it stands for and where it applies, and a form to
 * define one, change one or delete one. A name is saved through `saveName`, which says what is wrong
 * before anything is written, so the form shows it beside the field and the workbook never sees it.
 */

import { useState } from 'react';
import { Button, IconButton, Select, TextField } from '../../core/controls';
import { pencilSimpleIcon, trashIcon } from '../../core/icons';
import { Modal, useModalClose } from '../../core/ui';
import { WORKBOOK, deleteName, listNames, saveName, selectionRef, type NameRow } from '../modules/formulaActions';
import { Actions, Fields, useModelVersion, type ToolProps } from './parts';

interface Form {
  name: string;
  scope: string;
  refersTo: string;
  replaces?: { name: string; scope?: string };
}

function Close() {
  const close = useModalClose();
  return (
    <Actions>
      <Button variant="secondary" onClick={close}>
        Close
      </Button>
    </Actions>
  );
}

export default function NameManager({ ctx, onClose, fromSelection }: ToolProps & { fromSelection?: boolean }) {
  useModelVersion(ctx.model);
  const [form, setForm] = useState<Form | null>(() => (fromSelection ? { name: '', scope: '', refersTo: selectionRef(ctx, ctx.selection().rect) } : null));
  const [error, setError] = useState('');
  const names = listNames(ctx);
  const edit = ctx.can.edit;

  const open = (row?: NameRow) => {
    setError('');
    setForm(
      row
        ? { name: row.name, scope: row.scope ?? '', refersTo: row.refersTo, replaces: { name: row.name, ...(row.scope === undefined ? {} : { scope: row.scope }) } }
        : { name: '', scope: '', refersTo: selectionRef(ctx, ctx.selection().rect) }
    );
  };

  const save = () => {
    if (!form) return;
    const res = saveName(ctx, {
      name: form.name,
      ...(form.scope ? { scope: form.scope } : {}),
      refersTo: form.refersTo,
      ...(form.replaces ? { replaces: form.replaces } : {})
    });
    if (res.ok) setForm(null);
    else setError(res.message);
  };

  const set = (patch: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setError('');
  };

  return (
    <Modal title="Names" width={640} onClose={onClose} footer={<Close />}>
      <div className="sx-stack">
        {form ? (
          <form
            className="sx-stack"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <h3 className="sx-heading">{form.replaces ? 'Edit name' : 'New name'}</h3>
            <Fields>
              <TextField label="Name" value={form.name} autoFocus onChange={(e) => set({ name: e.target.value })} />
              <Select
                label="Applies to"
                value={form.scope}
                options={[{ value: '', label: WORKBOOK }, ...ctx.model.sheets().map((s) => ({ value: s.id, label: s.name }))]}
                onChange={(v) => set({ scope: v })}
                style={{ width: 200, flex: 'none' }}
              />
            </Fields>
            <TextField
              label="Stands for"
              style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12.5 }}
              value={form.refersTo}
              placeholder="=Sheet1!$B$2:$B$9"
              onChange={(e) => set({ refersTo: e.target.value })}
              trailing={
                <Button type="button" size="sm" variant="ghost" onClick={() => set({ refersTo: selectionRef(ctx, ctx.selection().rect) })}>
                  Use selection
                </Button>
              }
            />
            {error && (
              <p className="sx-note" data-tone="danger" role="alert">
                {error}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="submit" variant="primary" size="sm" disabled={!edit}>
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setForm(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button variant="secondary" size="sm" disabled={!edit} onClick={() => open()}>
              New name
            </Button>
          </div>
        )}

        <div className="sx-list sx-names" role="table" aria-label="Defined names">
          <div className="sx-name-row sx-name-head" role="row">
            <span role="columnheader">Name</span>
            <span role="columnheader">Stands for</span>
            <span role="columnheader">Applies to</span>
            <span />
          </div>
          {names.length === 0 && <p className="sx-empty">No names yet.</p>}
          {names.map((n) => (
            <div className="sx-name-row" role="row" key={`${n.scope ?? ''}|${n.name}`}>
              <span role="cell">{n.name}</span>
              <span role="cell" className="sx-mono" title={n.refersTo}>
                {n.refersTo}
              </span>
              <span role="cell">{n.scopeLabel}</span>
              <span className="sx-name-tools">
                <IconButton icon={pencilSimpleIcon} label={`Edit ${n.name}`} size="sm" disabled={!edit} onClick={() => open(n)} />
                <IconButton icon={trashIcon} label={`Delete ${n.name}`} size="sm" disabled={!edit} onClick={() => deleteName(ctx, n.name, n.scope)} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
