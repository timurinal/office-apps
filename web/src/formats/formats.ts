/**
 * The export formats and what a model refers to: the parts of `export.ts` the page can know
 * without loading a single converter.
 */

import type { DocModel } from './types';

export type ExportFormat = 'docx' | 'markdown' | 'html' | 'text';

export const EXPORT_FORMATS: Record<ExportFormat, { label: string; extension: string; mime: string }> = {
  docx: { label: 'Word document (.docx)', extension: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  markdown: { label: 'Markdown (.md)', extension: 'md', mime: 'text/markdown;charset=utf-8' },
  html: { label: 'Web page (.html)', extension: 'html', mime: 'text/html;charset=utf-8' },
  text: { label: 'Plain text (.txt)', extension: 'txt', mime: 'text/plain;charset=utf-8' }
};

/** The picture sources a model refers to, in order and once each. */
export function imageSources(model: DocModel): string[] {
  const seen = new Set<string>();
  const visit = (n: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
    if (n.type === 'image' && typeof n.attrs?.src === 'string') seen.add(n.attrs.src);
    for (const c of (n.content ?? []) as (typeof n)[]) visit(c);
  };
  visit(model.body);
  return [...seen];
}
