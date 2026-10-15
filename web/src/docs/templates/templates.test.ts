/**
 * Every predefined template, built through the real editor schema, the way a card press builds
 * it: if a node is in the wrong place or an attribute is one the editor does not have, this is
 * where it fails, and not in front of a reader.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LIMITS } from '@shared/api';
import { fragmentName, hfSchema } from '../pagination/headerFooter';
import { headingsOf, serialiseEntries } from '../pagination/nodes';
import { PAGE_MAP, readSetup } from '../pagination/setup';
import { docsSchema, stateJSON } from '../seed';
import { headingEntries } from './build';
import { DOCS_TEMPLATES, findDocsTemplate, predefinedId, predefinedSummaries, PREDEFINED_PREFIX, sketchFor } from './index';
import { templateBase64, templateState } from './state';

const walk = (n: { type?: string; content?: unknown[] }, visit: (n: { type?: string; attrs?: Record<string, unknown>; text?: string }) => void) => {
  visit(n);
  for (const child of (n.content ?? []) as { type?: string; content?: unknown[] }[]) walk(child, visit);
};

describe('the predefined Docs templates', () => {
  it('are six to eight, each with a slug, a title and a description that cannot be mistaken for another', () => {
    expect(DOCS_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(DOCS_TEMPLATES.length).toBeLessThanOrEqual(8);
    for (const t of DOCS_TEMPLATES) {
      expect(t.slug, t.title).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.title.length).toBeLessThanOrEqual(40);
      expect(t.description.length).toBeGreaterThan(0);
      // `templateId` is at most 200 characters in the create call.
      expect(predefinedId(t).length).toBeLessThan(200);
    }
    for (const key of ['slug', 'title', 'description'] as const) {
      expect(new Set(DOCS_TEMPLATES.map((t) => t[key])).size, key).toBe(DOCS_TEMPLATES.length);
    }
  });

  it('are found by the id a card passes on, and nothing else is', () => {
    for (const t of DOCS_TEMPLATES) expect(findDocsTemplate(`${PREDEFINED_PREFIX}${t.slug}`)).toBe(t);
    expect(findDocsTemplate('predefined:nope')).toBeUndefined();
    expect(findDocsTemplate('meeting-notes')).toBeUndefined();
  });

  it('are listed in the shelf’s own shape, as predefined and for Docs', () => {
    const list = predefinedSummaries();
    expect(list.map((t) => t.id)).toEqual(DOCS_TEMPLATES.map(predefinedId));
    for (const t of list) expect(t).toMatchObject({ kind: 'docs', scope: 'predefined', ownerName: null });
  });

  for (const t of DOCS_TEMPLATES) {
    describe(t.title, () => {
      it('is valid in the editor’s schema and builds a Yjs state', () => {
        // `templateState` runs `seedState`, which checks every node against the schema.
        expect(() => templateState(t)).not.toThrow();
      });

      it('is well under the document cap, and lean', () => {
        const bytes = templateState(t).byteLength;
        expect(bytes).toBeLessThan(LIMITS.docStateMaxBytes);
        expect(bytes).toBeLessThan(32 * 1024);
      });

      it('goes in the create call as base64 that decodes to the same content', () => {
        // Two builds differ in their client id, so the bytes are compared by what they hold.
        const back = Uint8Array.from(atob(templateBase64(t)), (c) => c.charCodeAt(0));
        expect(stateJSON(back)).toEqual(stateJSON(templateState(t)));
      });

      it('keeps its content: the body comes back as it was written, plus the paragraph that ends it', () => {
        const got = stateJSON(templateState(t)).content ?? [];
        expect(got.map((n) => n.type)).toEqual([...t.body.map((n) => n.type), ...(t.body.at(-1)?.type === 'paragraph' ? [] : ['paragraph'])]);
        const texts = (nodes: unknown[]) => {
          const out: string[] = [];
          for (const n of nodes) walk(n as never, (x) => x.text && out.push(x.text));
          return out;
        };
        expect(texts(got)).toEqual(texts(t.body));
      });

      it('holds no node the editor’s own commands could not have made', () => {
        const known = new Set(Object.keys(docsSchema().nodes));
        const unknown: string[] = [];
        for (const n of t.body) walk(n, (x) => x.type && !known.has(x.type) && unknown.push(x.type));
        expect(unknown).toEqual([]);
      });

      it('has no sentence ending in an ellipsis and says nothing about end-to-end encryption', () => {
        const all: string[] = [];
        for (const n of t.body) walk(n, (x) => x.text && all.push(x.text));
        const text = all.join(' ');
        expect(text).not.toMatch(/…|\.\.\./);
        expect(text).not.toMatch(/end-to-end|zero-knowledge/i);
      });
    });
  }

  it('write each header and footer in the header schema, in the fragments the page reads', () => {
    for (const t of DOCS_TEMPLATES) {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, templateState(t));
      for (const [kind, blocks] of [['header', t.header], ['footer', t.footer]] as const) {
        const fragment = doc.getXmlFragment(fragmentName(kind, 'default'));
        if (!blocks) {
          expect(fragment.length, `${t.title} ${kind}`).toBe(0);
          continue;
        }
        expect(fragment.length).toBe(blocks.length);
        hfSchema().nodeFromJSON({ type: 'doc', content: blocks }).check();
      }
      // The first page's own fragments stay empty: a cover has no header.
      expect(doc.getXmlFragment(fragmentName('header', 'first')).length).toBe(0);
      expect(doc.getXmlFragment(fragmentName('footer', 'first')).length).toBe(0);
    }
  });

  it('write the page setup under the keys the page view reads, and never a paper size', () => {
    for (const t of DOCS_TEMPLATES) {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, templateState(t));
      const map = doc.getMap<unknown>(PAGE_MAP);
      // The editor writes A4, or Letter in en-US, on the first edit; a template that said
      // one would take the choice from the reader.
      expect(map.has('size'), t.title).toBe(false);
      expect(map.has('paged'), t.title).toBe(false);
      const setup = readSetup(map, 'A4');
      expect(setup.orientation).toBe(t.page?.orientation ?? 'portrait');
      expect(setup.differentFirst).toBe(t.page?.differentFirst ?? false);
      if (t.page?.margins) expect(setup.margins).toEqual(t.page.margins);
    }
  });

  it('use the page setup, headers and footers where a document of that kind would', () => {
    const by = (slug: string) => findDocsTemplate(predefinedId({ slug }))!;
    expect(by('weekly-plan').page?.orientation).toBe('landscape');
    expect(by('report').page?.differentFirst).toBe(true);
    expect(by('report').footer).toBeDefined();
    expect(by('cv').page?.margins).toBeDefined();
    const kinds: string[] = [];
    for (const n of by('report').footer ?? []) walk(n, (x) => x.type === 'pageField' && kinds.push(String(x.attrs?.kind)));
    expect(kinds).toEqual(['page', 'pages']);
  });

  describe('the report’s table of contents', () => {
    const t = findDocsTemplate('predefined:report')!;

    it('lists the headings the report has, as the page’s own "Update table" would', () => {
      const toc = t.body.find((n) => n.type === 'tableOfContents')!;
      const node = docsSchema().nodeFromJSON({ type: 'doc', content: t.body });
      expect(toc.attrs?.entries).toBe(serialiseEntries(headingsOf(node)));
      expect(headingEntries(t.body).map((e) => e.text)).toEqual(['Summary', 'Background', 'Findings', 'First finding', 'Second finding', 'Recommendations']);
    });

    it('puts a page break before the contents and after them, so the cover and the contents are pages of their own', () => {
      const types = t.body.map((n) => n.type);
      const toc = types.indexOf('tableOfContents');
      // The table has the page to itself, between two breaks: it draws its own heading.
      expect(types.slice(toc - 1, toc + 2)).toEqual(['pageBreak', 'tableOfContents', 'pageBreak']);
      expect(types.filter((x) => x === 'pageBreak').length).toBe(2);
    });
  });

  it('draw a page each: no two cards show the same one', () => {
    const drawn = DOCS_TEMPLATES.map((t) => JSON.stringify(sketchFor(predefinedId(t))));
    expect(new Set(drawn).size).toBe(DOCS_TEMPLATES.length);
  });
});
