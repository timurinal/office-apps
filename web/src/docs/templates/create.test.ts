import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createRequest } from './create';
import { DOCS_TEMPLATES, predefinedId } from './index';
import { stateJSON } from '../seed';

const decode = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

describe('the create call for a card on Home', () => {
  it('is just the kind for a blank document', async () => {
    expect(await createRequest('docs')).toEqual({ kind: 'docs' });
    expect(await createRequest('sheets')).toEqual({ kind: 'sheets' });
  });

  it('is the template’s id for the reader’s own and the organisation’s, which the server copies', async () => {
    expect(await createRequest('docs', 'doc_9f3')).toEqual({ kind: 'docs', templateId: 'doc_9f3' });
  });

  it('is the title and the content for a predefined template, and never its id, which the server does not know', async () => {
    for (const t of DOCS_TEMPLATES) {
      const req = await createRequest('docs', predefinedId(t));
      expect(req.kind).toBe('docs');
      expect(req.title).toBe(t.title);
      expect(req.templateId, t.title).toBeUndefined();
      expect(typeof req.state).toBe('string');
      const doc = new Y.Doc();
      Y.applyUpdate(doc, decode(req.state!));
      expect(doc.getXmlFragment('default').length).toBeGreaterThan(0);
      expect(stateJSON(decode(req.state!)).content?.[0]?.type).toBe(t.body[0]!.type);
    }
  });

  it('passes an id it does not have on to the server, which says it is not available', async () => {
    expect(await createRequest('docs', 'predefined:nope')).toEqual({ kind: 'docs', templateId: 'predefined:nope' });
  });
});
