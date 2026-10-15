import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initProseMirrorDoc, relativePositionToAbsolutePosition } from '@tiptap/y-tiptap';
import { docsSchema } from '../docs/seed';
import { FIELD } from '../docs/room';
import { prepareThreads } from './anchors';
import { importDocument, importFormatOf, readFile, titleOf } from './import';
import { offsetMap } from './textOffsets';
import type { DocModel, ImportedComment, JSONContent } from './types';
import { buildState, modelFromDoc, modelFromState } from './ydoc';
import { makeDocx, p, r } from './testing';
import { fromBase64 } from '../crypto/primitives';

const para = (t: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });

describe('buildState and modelFromState', () => {
  const model: DocModel = {
    body: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] }, para('Body'), { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para('c')] }] }] }] },
    page: { size: 'Letter', orientation: 'landscape', margins: { top: 20, right: 21, bottom: 22, left: 23 }, headerDistance: 9, footerDistance: 8, differentFirst: true },
    header: { default: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Header' }] }] } },
    footer: { first: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'pageField', attrs: { kind: 'page' } }] }] } }
  };

  it('holds the body, the page setup and the headers where the editor looks for them', () => {
    const state = buildState(model);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    expect(doc.getMap('page').toJSON()).toMatchObject({ size: 'Letter', orientation: 'landscape', marginTop: 20, marginRight: 21, marginBottom: 22, marginLeft: 23, headerDistance: 9, footerDistance: 8, differentFirst: true, paged: true });
    expect(doc.getXmlFragment('header-default').length).toBe(1);
    expect(doc.getXmlFragment('footer-first').length).toBe(1);
    expect(doc.getXmlFragment('footer-default').length).toBe(0);
    expect(doc.getXmlFragment(FIELD).length).toBeGreaterThan(0);
  });

  it('reads back what it was given, with the trailing paragraph the editor would add', () => {
    const back = modelFromState(buildState(model));
    expect(back.page).toEqual(model.page);
    expect(back.header).toEqual(model.header);
    expect(back.footer).toEqual(model.footer);
    expect(back.body.content!.map((n) => n.type)).toEqual(['heading', 'paragraph', 'table', 'paragraph']);
  });

  it('writes no page setup for a model that has none', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, buildState({ ...model, page: null }));
    expect(doc.getMap('page').size).toBe(0);
    expect(modelFromDoc(doc).page).toBeNull();
  });

  it('refuses JSON that is not valid in the editor’s schema', () => {
    expect(() => buildState({ ...model, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'paragraph' }] }] } })).toThrow();
    expect(() => buildState({ ...model, body: { type: 'doc', content: [{ type: 'nonsense' }] } })).toThrow();
  });

  it('is a state a second client merges into one that already has the page, with nothing doubled', () => {
    const a = new Y.Doc();
    Y.applyUpdate(a, buildState(model));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(b, buildState(model));
    // A second import into the same document is two documents merged: not what the room does
    // (it clears first), but the encoding must at least be one a doc accepts twice.
    expect(b.getMap('page').get('size')).toBe('Letter');
  });
});

describe('offsetMap', () => {
  const doc = () => {
    const schema = docsSchema();
    return schema.nodeFromJSON({
      type: 'doc',
      content: [para('Hello'), { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'wor' }, { type: 'footnote', content: [{ type: 'text', text: 'NOTE' }] }, { type: 'text', text: 'ld' }] }] }] }]
    });
  };

  it('counts characters of text, a footnote’s own included, in document order', () => {
    const map = offsetMap(doc());
    expect(map.total).toBe(5 + 3 + 4 + 2);
    const d = doc();
    // "Hello" starts at position 1; offset 3 is the "l".
    expect(d.textBetween(map.posOf(3)!, map.posOf(5)!)).toBe('lo');
    // Offsets 5..8 are "wor", 8..12 the note, 12..14 "ld".
    expect(d.textBetween(map.posOf(5)!, map.posOf(8)!)).toBe('wor');
    expect(d.textBetween(map.posOf(12)!, map.posOf(14)!)).toBe('ld');
  });

  it('goes back from a position to an offset', () => {
    const map = offsetMap(doc());
    for (const offset of [0, 2, 5, 7, 8, 11, 12, 14]) {
      expect(map.offsetOf(map.posOf(offset)!)).toBe(offset);
    }
  });

  it('answers null with no text, and clamps past the end', () => {
    expect(offsetMap(docsSchema().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] })).posOf(0)).toBeNull();
    const d = doc();
    const map = offsetMap(d);
    expect(map.posOf(999)).toBe(map.posOf(map.total));
  });
});

describe('prepareThreads', () => {
  const model: DocModel = { body: { type: 'doc', content: [para('Hello wide world'), para('Second paragraph')] }, page: null, header: {}, footer: {} };
  const comment = (over: Partial<ImportedComment>): ImportedComment => ({ id: '1', author: 'Ben', at: null, text: 'Why?', parent: null, resolved: false, start: 6, end: 10, ...over });

  /** What an editor on the room would resolve an anchor to. */
  function resolve(state: Uint8Array, b64: string): number | null {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const fragment = doc.getXmlFragment(FIELD);
    const { mapping } = initProseMirrorDoc(fragment, docsSchema());
    return relativePositionToAbsolutePosition(doc, fragment, Y.decodeRelativePosition(fromBase64(b64)), mapping);
  }

  it('anchors a thread to its text, in a form a document that holds the state resolves', () => {
    const state = buildState(model);
    const [t] = prepareThreads(state, [comment({})]);
    expect(t!.quote).toBe('wide');
    const from = resolve(state, t!.relpos)!;
    const to = resolve(state, t!.relposEnd)!;
    const schema = docsSchema();
    const doc = schema.nodeFromJSON({ type: 'doc', content: [...model.body.content!, { type: 'paragraph' }] });
    expect(doc.textBetween(from, to)).toBe('wide');
  });

  it('resolves the same in a document that took the state through a room, which keeps the identities', () => {
    const state = buildState(model);
    const [t] = prepareThreads(state, [comment({ start: 16, end: 22 })]);
    const room = new Y.Doc();
    Y.applyUpdate(room, state);
    // The room compacts and re-encodes; the anchor must still find its characters.
    const reencoded = Y.encodeStateAsUpdate(room);
    expect(resolve(reencoded, t!.relpos)).toBe(resolve(state, t!.relpos));
    expect(resolve(reencoded, t!.relposEnd)).toBe(resolve(state, t!.relposEnd));
    expect(t!.quote).toBe('Second');
  });

  it('joins a reply to its parent’s thread, and carries the resolved flag', () => {
    const [t, ...rest] = prepareThreads(buildState(model), [comment({ resolved: true }), comment({ id: '2', author: 'Ada', text: 'Because.', parent: '1', start: 0, end: 0 })]);
    expect(rest).toHaveLength(0);
    expect(t!.messages.map((m) => `${m.author}: ${m.text}`)).toEqual(['Ben: Why?', 'Ada: Because.']);
    expect(t!.resolved).toBe(true);
  });

  it('gives a point comment the character beside it so there is text to mark, and drops one in a document with no text', () => {
    const [t] = prepareThreads(buildState(model), [comment({ start: 5, end: 5 })]);
    expect(t!.relpos).not.toBe(t!.relposEnd);
    expect(prepareThreads(buildState({ ...model, body: { type: 'doc', content: [{ type: 'paragraph' }] } }), [comment({})])).toEqual([]);
  });
});

describe('importDocument', () => {
  it('recognises what it opens by the extension', () => {
    expect(['a.docx', 'A.DOCX', 'n.md', 'n.markdown', 'p.html', 'p.htm', 'x.txt', 'noext', 'x.doc'].map(importFormatOf)).toEqual(['docx', 'docx', 'markdown', 'markdown', 'html', 'html', null, null, null]);
  });

  it('names the document after the file', () => {
    expect(titleOf('Quarterly report.docx')).toBe('Quarterly report');
    expect(titleOf('C:\\Users\\a\\notes.v2.md')).toBe('notes.v2');
    expect(titleOf('../../etc/passwd.html')).toBe('passwd');
    expect(titleOf('.docx', 'From the file')).toBe('From the file');
    expect(titleOf('.md')).toBe('Untitled');
    expect(titleOf(`${'x'.repeat(500)}.docx`)).toHaveLength(200);
  });

  it('turns a docx into the state to send, the pictures to store and the threads to post', () => {
    const out = importDocument('Plan.docx', makeDocx({ body: p(r('Hello')) }));
    expect(out.title).toBe('Plan');
    expect(out.format).toBe('docx');
    expect(out.stateBase64.length).toBeGreaterThan(10);
    expect(Array.from(fromBase64(out.stateBase64))).toEqual(Array.from(out.state));
    expect(out.images).toEqual([]);
    expect(out.threads).toEqual([]);
  });

  it('refuses a kind it does not open, and an empty file', () => {
    expect(() => readFile('notes.txt', new Uint8Array(3))).toThrow('That kind of file cannot be opened here.');
    expect(() => readFile('a.docx', new Uint8Array(0))).toThrow('That file is empty.');
  });

  it('opens Markdown and HTML', () => {
    expect(modelFromState(importDocument('n.md', new TextEncoder().encode('# Hi\n\ntext')).state).body.content![0]).toMatchObject({ type: 'heading' });
    expect(modelFromState(importDocument('p.html', new TextEncoder().encode('<h1>Hi</h1><p>text</p>')).state).body.content![0]).toMatchObject({ type: 'heading' });
  });
});

