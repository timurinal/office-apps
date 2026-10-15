import { describe, expect, it } from 'vitest';
import { normaliseLink } from './links';

describe('normaliseLink', () => {
  it('adds https to a bare address', () => {
    expect(normaliseLink('example.com')).toBe('https://example.com');
    expect(normaliseLink(' office.example.com/docs ')).toBe('https://office.example.com/docs');
  });

  it('keeps a full address as typed', () => {
    expect(normaliseLink('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
    expect(normaliseLink('http://localhost:8799/docs/x')).toBe('http://localhost:8799/docs/x');
  });

  it('turns an email address into a mailto link', () => {
    expect(normaliseLink('ada@office.test')).toBe('mailto:ada@office.test');
    expect(normaliseLink('mailto:ada@office.test')).toBe('mailto:ada@office.test');
  });

  it('refuses every scheme that can run or carry code', () => {
    expect(normaliseLink('javascript:alert(1)')).toBeNull();
    expect(normaliseLink('JaVaScRiPt:alert(1)')).toBeNull();
    expect(normaliseLink('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(normaliseLink('vbscript:msgbox(1)')).toBeNull();
    expect(normaliseLink('file:///etc/passwd')).toBeNull();
    expect(normaliseLink('blob:https://x/y')).toBeNull();
  });

  it('refuses what is not an address at all', () => {
    expect(normaliseLink('')).toBeNull();
    expect(normaliseLink('   ')).toBeNull();
    expect(normaliseLink('two words')).toBeNull();
    expect(normaliseLink('plan')).toBeNull();
    expect(normaliseLink('https://plan')).toBeNull();
    expect(normaliseLink('mailto:nobody')).toBeNull();
  });
});
