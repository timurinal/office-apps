import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { ContainerError, readContainer, writeContainer } from './container';

const state = new Uint8Array([1, 2, 3, 4]);

describe('the native file', () => {
  it('round-trips a document and a workbook', () => {
    const docs = readContainer(writeContainer({ kind: 'docs', id: 'abc', title: 'Note', app: 'Office 0.1.0', state }), 'docs');
    expect(docs.manifest).toMatchObject({ format: 'office', version: 1, kind: 'docs', id: 'abc', title: 'Note' });
    expect([...docs.state]).toEqual([1, 2, 3, 4]);
    expect(docs.cells).toBeNull();

    const cells = new Uint8Array([9, 9]);
    const book = readContainer(writeContainer({ kind: 'sheets', id: 'b', title: 'Book', app: 'Office', state, cells }));
    expect([...book.cells!]).toEqual([9, 9]);
  });

  it('puts the mimetype first, stored', () => {
    const bytes = writeContainer({ kind: 'docs', id: 'a', title: 't', app: 'x', state });
    // A local file header: signature, version, flags, then the method (0 = stored), then the name at 30.
    expect(bytes[8]).toBe(0);
    expect(new TextDecoder().decode(bytes.subarray(30, 38))).toBe('mimetype');
  });

  it('refuses what it did not write', () => {
    const bad = (files: Record<string, Uint8Array>) => () => readContainer(zipSync(files));
    expect(() => readContainer(new Uint8Array([1, 2, 3]))).toThrow(ContainerError);
    expect(bad({ 'state.bin': state })).toThrow(/could not be opened/);
    expect(bad({ 'manifest.json': strToU8('{'), 'state.bin': state })).toThrow(ContainerError);
    expect(bad({ 'manifest.json': strToU8(JSON.stringify({ format: 'other', version: 1, kind: 'docs', id: 'a' })), 'state.bin': state })).toThrow(ContainerError);
    expect(bad({ 'manifest.json': strToU8(JSON.stringify({ format: 'office', version: 2, kind: 'docs', id: 'a' })), 'state.bin': state })).toThrow(ContainerError);
    expect(bad({ 'manifest.json': strToU8(JSON.stringify({ format: 'office', version: 1, kind: 'sheets', id: 'a' })), 'state.bin': state })).toThrow(ContainerError);
    const sheet = writeContainer({ kind: 'sheets', id: 'a', title: 't', app: 'x', state, cells: state });
    expect(() => readContainer(sheet, 'docs')).toThrow(ContainerError);
  });

  it('refuses a zip with too many entries', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 20; i++) files[`f${i}`] = state;
    expect(() => readContainer(zipSync(files))).toThrow(ContainerError);
  });
});
