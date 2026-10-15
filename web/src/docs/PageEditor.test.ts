// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { chromeInsets } from './PageEditor';

describe('chromeInsets', () => {
  it('reads the banner height the shell keeps current', () => {
    const shell = document.createElement('div');
    shell.style.setProperty('--shell-top', '172px');
    expect(chromeInsets(shell)).toEqual({ top: 172, bottom: 56 });
    shell.style.setProperty('--shell-top', '96px');
    expect(chromeInsets(shell).top).toBe(96);
  });

  it('is zero without a shell, so a bare page scrolls as ProseMirror usually does', () => {
    expect(chromeInsets(null)).toEqual({ top: 0, bottom: 0 });
    expect(chromeInsets(document.createElement('div'))).toEqual({ top: 0, bottom: 0 });
  });
});
