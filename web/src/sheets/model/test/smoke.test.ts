import { describe, expect, it } from 'vitest';
import { room, text, type, edit } from './helpers';

describe('smoke', () => {
  it('two people see one edit', () => {
    const { room: r, people, sheet } = room();
    const [a, b] = people;
    expect(type(a!.model, sheet, 'A1', '2')).toBe(true);
    type(a!.model, sheet, 'A2', '=A1*3');
    expect(text(a!.model, sheet, 'A2')).toBe('6');
    r.flush();
    expect(text(b!.model, sheet, 'A2')).toBe('6');
    expect(edit(b!.model, sheet, 'A2')).toBe('=A1*3');
    expect(a!.model.status().save).toBe('saved');
  });
});
