import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('./api', () => ({ get: vi.fn(), request: vi.fn(), requestBytes: vi.fn(), send: (...a: unknown[]) => send(...a) }));

import { decodeCellList } from '@shared/cells';
import { fromBase64 } from './crypto/primitives';
import { documents } from './client';

beforeEach(() => send.mockReset().mockResolvedValue({ id: 'd', kind: 'sheets' }));

const bodyOfLastCall = () => send.mock.calls.at(-1)![2] as Record<string, unknown>;

describe('making a document by kind alone', () => {
  it('gives a spreadsheet the blank workbook the room needs, built here', async () => {
    await documents.create({ kind: 'sheets' });
    const body = bodyOfLastCall();
    expect(body.kind).toBe('sheets');
    expect(typeof body.state).toBe('string');
    expect((body.state as string).length).toBeGreaterThan(100);
    // No cells yet, and a list that reads.
    expect(decodeCellList(fromBase64(body.cells as string))).toEqual([]);
  });

  it('keeps the title and the rest of what was asked for', async () => {
    await documents.create({ kind: 'sheets', title: 'Budget' });
    expect(bodyOfLastCall().title).toBe('Budget');
  });

  it('leaves everything else as it was: other kinds, a template, a body that has its own state', async () => {
    await documents.create({ kind: 'docs' });
    expect(bodyOfLastCall()).toEqual({ kind: 'docs' });
    await documents.create({ kind: 'sheets', templateId: 't1' });
    expect(bodyOfLastCall()).toEqual({ kind: 'sheets', templateId: 't1' });
    await documents.create({ kind: 'sheets', state: 'AAAA' });
    expect(bodyOfLastCall()).toEqual({ kind: 'sheets', state: 'AAAA' });
  });
});
