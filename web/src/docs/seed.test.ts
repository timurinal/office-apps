/**
 * The seed, in Node: no DOM at all. That is the point of the first test: it is the proof
 * that the same code runs in a Web Worker.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LIMITS } from '@shared/api';
import { docsSchema, seedBase64, seedState, SeedTooLarge, stateJSON, toBase64 } from './seed';

const text = (t: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });

const SAMPLE = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Q4 plan')] },
    { type: 'paragraph', attrs: { paraStyle: 'subtitle' }, content: [text('Course team')] },
    {
      type: 'paragraph',
      attrs: { textAlign: 'center', lineHeight: 1.5, spaceAfter: 12, indent: 1 },
      content: [text('Ship the '), text('course library', [{ type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '14pt', color: '#3d6cd0' } }]), text(' by '), text('November', [{ type: 'link', attrs: { href: 'https://example.com' } }])]
    },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('3 Nov')] }] }] },
    { type: 'orderedList', attrs: { start: 1, format: 'legal' }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('First')] }] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [text('Done')] }] }] },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { backgroundColor: '#f1f3f9' }, content: [{ type: 'paragraph', content: [text('Owner')] }] }, { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'u1', label: 'Ada Rowe' } }] }] }] }
      ]
    },
    { type: 'paragraph', content: [{ type: 'dateChip', attrs: { date: '2026-10-14' } }, text(' and '), { type: 'docLink', attrs: { docId: 'd2', kind: 'sheets', title: 'Budget' } }] },
    { type: 'image', attrs: { src: '/api/office/documents/d1/assets/a1', width: 300, height: 200, align: 'center' } },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [text('Quoted')] }] },
    { type: 'codeBlock', content: [text('let x = 1')] },
    { type: 'horizontalRule' }
  ]
};

describe('seeding a document from ProseMirror JSON', () => {
  it('runs with no DOM at all, so it can run in a Web Worker', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    expect(() => seedState({ type: 'doc', content: [{ type: 'paragraph', content: [text('Hello')] }] })).not.toThrow();
  });

  it('makes an update that holds the content on the editor’s field and nowhere else', () => {
    const state = seedState(SAMPLE);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    expect([...doc.share.keys()]).toEqual(['default']);
    // The sample ends in a rule, so a paragraph follows it to type in.
    expect(doc.getXmlFragment('default').length).toBe(SAMPLE.content.length + 1);
  });

  it('round-trips every kind of content this editor has, attributes and marks included', () => {
    const back = stateJSON(seedState(SAMPLE));
    // Marks are stored in the schema's order, not the order they were written in.
    const norm = (j: unknown) =>
      JSON.parse(
        JSON.stringify(j, (_k, v) => {
          if (v === null) return undefined;
          return Array.isArray(v) && v.every((m) => m && typeof m === 'object' && 'type' in m && !('content' in m)) ? [...v].sort((x, y) => String(x.type).localeCompare(String(y.type))) : v;
        })
      );
    // Attributes the schema defaults come back too, so compare what was sent.
    const sent = SAMPLE.content;
    const got = back.content!;
    expect(got.map((n) => n.type)).toEqual([...sent.map((n) => n.type), 'paragraph']);
    expect(norm(got[0])).toMatchObject(norm(sent[0]));
    expect(norm(got[2])).toMatchObject(norm(sent[2]));
    expect(norm(got[4])).toMatchObject(norm(sent[4]));
    expect(norm(got[5])).toMatchObject(norm(sent[5]));
    expect(norm(got[6])).toMatchObject(norm(sent[6]));
    expect(norm(got[7])).toMatchObject(norm(sent[7]));
    expect(norm(got[8])).toMatchObject(norm(sent[8]));
  });

  it('refuses JSON this editor’s schema does not allow', () => {
    expect(() => seedState({ type: 'doc', content: [{ type: 'mystery', content: [] }] })).toThrow();
    expect(() => seedState({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'paragraph' }] }] })).toThrow();
  });

  it('knows every node the base list and the core module add', () => {
    const names = Object.keys(docsSchema().nodes);
    for (const n of ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader', 'image', 'mention', 'dateChip', 'docLink']) {
      expect(names, n).toContain(n);
    }
    expect(docsSchema()).toBe(docsSchema());
  });

  it('seeds an empty document, as an empty update', () => {
    const state = seedState({ type: 'doc', content: [{ type: 'paragraph' }] });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    expect(doc.getXmlFragment('default').length).toBe(1);
  });

  it('refuses a document whose update is over the room’s cap, by throwing the size', () => {
    // Incompressible text: a repeated one would encode small.
    let s = 1;
    const noise = () => Array.from({ length: 4000 }, () => String.fromCharCode(0x4e00 + ((s = (s * 1103515245 + 12345) & 0x7fffffff) % 20000))).join('');
    const big = { type: 'doc', content: Array.from({ length: 300 }, () => ({ type: 'paragraph', content: [text(noise())] })) };
    let caught: unknown;
    try {
      seedState(big);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SeedTooLarge);
    expect((caught as SeedTooLarge).bytes).toBeGreaterThan(LIMITS.docStateMaxBytes);
  });

  it('encodes base64 the way the server decodes it, for any length, and a large update does not overflow', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100, 0x8000, 0x8001, 200_000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 7) & 255);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
    expect(seedBase64({ type: 'doc', content: [{ type: 'paragraph', content: [text('Hello')] }] })).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
});
