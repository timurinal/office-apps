// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileSections, searchCommands } from '../../core/shell/registry';
import { collect, problems } from './collect';
import { DOCS_MODULES } from './index';
import type { DocsContext } from './types';

const api = vi.hoisted(() => ({ set: vi.fn(), list: vi.fn() }));
vi.mock('../../client', () => ({ templates: api, documents: {} }));

const { loadOrganisation, resetOffers } = await import('../templates/offer');
const { templatesModule } = await import('./templates');

const ctx = (over: { template?: boolean; scope?: 'user' | 'org' | null } = {}): DocsContext => {
  const notify = vi.fn();
  return {
    source: { kind: 'cloud' },
    can: { template: over.template ?? true, rename: true, print: true },
    meta: { id: 'd1', kind: 'docs', title: 'Plan', ownerName: 'Ada', templateScope: over.scope ?? null },
    notify
  } as unknown as DocsContext;
};

const rows = (c: DocsContext) => fileSections(collect(DOCS_MODULES).fileItems, c).flatMap((s) => s.items).map((i) => i.label);
const commands = (c: DocsContext) => searchCommands(collect(DOCS_MODULES).commands, 'template', c, 20).map((x) => x.title);

beforeEach(() => {
  api.set.mockReset().mockResolvedValue({});
  api.list.mockReset();
  resetOffers();
});

describe('the templates module', () => {
  it('is one of the Docs modules and shares no id with another', () => {
    expect(DOCS_MODULES).toContain(templatesModule);
    expect(problems(DOCS_MODULES)).toEqual([]);
  });

  it('adds no extension and nothing to the ribbon: it is File menu rows and palette commands', () => {
    expect(templatesModule.extensions).toEqual([]);
    expect(templatesModule.ribbon).toEqual([]);
  });

  it('offers "Save as template" to a document that is not one, in the Document section beside Rename', () => {
    const labels = rows(ctx());
    expect(labels).toContain('Save as template');
    expect(labels).not.toContain('Remove from templates');
    expect(labels.indexOf('Save as template')).toBe(labels.indexOf('Rename') + 1);
    expect(commands(ctx())).toEqual(['Save as template']);
  });

  it('offers "Remove from templates" instead once it is one, whoever it is offered to', () => {
    for (const scope of ['user', 'org'] as const) {
      const labels = rows(ctx({ scope }));
      expect(labels, scope).toContain('Remove from templates');
      expect(labels, scope).not.toContain('Save as template');
    }
  });

  it('offers nothing to a person who cannot offer this document: a reader, the trash, a locked or a local file', () => {
    for (const label of ['Save as template', 'Save as company template', 'Remove from templates']) {
      expect(rows(ctx({ template: false }))).not.toContain(label);
    }
    expect(commands(ctx({ template: false }))).toEqual([]);
  });

  it('offers the company row only to someone the server said may, and only until it is a company template', async () => {
    expect(rows(ctx())).not.toContain('Save as company template');
    api.list.mockResolvedValue({ templates: [], organisation: { name: 'Northwind Studio', canOffer: true } });
    await loadOrganisation();
    expect(rows(ctx())).toEqual(expect.arrayContaining(['Save as template', 'Save as company template']));
    // A personal template can be promoted; a company one has nowhere further to go.
    expect(rows(ctx({ scope: 'user' }))).toEqual(expect.arrayContaining(['Save as company template', 'Remove from templates']));
    expect(rows(ctx({ scope: 'org' }))).not.toContain('Save as company template');
    expect(commands(ctx())).toEqual(['Save as template', 'Save as company template']);
  });

  it('runs the same act from the File menu and from the palette', async () => {
    const all = collect(DOCS_MODULES);
    const ready = async () => {
      resetOffers();
      api.list.mockResolvedValue({ templates: [], organisation: { name: 'N', canOffer: true } });
      await loadOrganisation();
      api.set.mockClear();
    };
    for (const [label, scope, scopeNow] of [['Save as template', 'user', null], ['Save as company template', 'org', null], ['Remove from templates', null, 'user']] as const) {
      await ready();
      all.fileItems.find((i) => i.label === label)!.run(ctx({ scope: scopeNow }));
      expect(api.set, `File > ${label}`).toHaveBeenCalledWith('d1', scope);
      await ready();
      all.commands.find((c) => c.title === label)!.run(ctx({ scope: scopeNow }));
      expect(api.set, `palette ${label}`).toHaveBeenCalledWith('d1', scope);
    }
  });
});
