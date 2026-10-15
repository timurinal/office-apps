import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { setPictureSources } from './importDocs';

describe('pictures from an imported file', () => {
  it('get their sources, and nothing else changes', () => {
    const doc = new Y.Doc();
    const body = doc.getXmlFragment('default');
    const p = new Y.XmlElement('paragraph');
    const a = new Y.XmlElement('image');
    a.setAttribute('src', 'import:0');
    const b = new Y.XmlElement('image');
    b.setAttribute('src', 'import:9');
    const c = new Y.XmlElement('image');
    c.setAttribute('src', 'data:image/png;base64,AAAA');
    p.insert(0, [a]);
    body.insert(0, [p, b, c]);
    const n = setPictureSources(doc, new Map([['import:0', 'data:image/png;base64,QQ==']]));
    expect(n).toBe(1);
    expect(a.getAttribute('src')).toBe('data:image/png;base64,QQ==');
    expect(b.getAttribute('src')).toBe('import:9');
    expect(c.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });
});
