/**
 * A Docs document to docx.
 *
 * The file is written with the `docx` package (MIT) from the same model the reader makes, so
 * what the reader keeps, the writer puts back: the named styles, fonts and sizes, lists
 * (with their numbering style and start), tables with merged cells, pictures, links,
 * footnotes, the page setup and its headers and footers, comments with their replies, and
 * suggestions as tracked changes.
 *
 * Pictures arrive through `resolveImage`, because the writer has no network and does not
 * know where a document keeps its assets. A picture it cannot resolve, or in a format Word
 * does not take, is left out and counted.
 *
 * The package builds in memory and has no DOM dependency, so the same code runs in the page,
 * in a worker, and in a server-side exporter.
 */

import {
  AlignmentType,
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
  InsertedTextRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  SimpleField,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalMergeType,
  WidthType,
  type FileChild,
  type ILevelsOptions,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild
} from 'docx';
import { Warnings, plural, type DocModel, type ExportComment, type ExportOptions, type ImageData, type JSONContent, type Warning } from '../types';
import { imageSize } from '../images';
import { isSafeHref } from '../../docs/core/links';
import { PAPER, defaultSetup, type PageSetup } from '../../docs/pagination/setup';
import { headingEntries, textOf } from '../model';

// ── units ───────────────────────────────────────────────────────────────────

const mmToTwips = (mm: number): number => Math.round((mm * 1440) / 25.4);
const ptToTwips = (pt: number): number => Math.round(pt * 20);
const pxToTwips = (px: number): number => Math.round(px * 15);
const hex = (c: string | null | undefined): string | undefined => {
  if (!c) return undefined;
  const m = /^#([0-9a-f]{6})$/i.exec(c) ?? /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (!m) return undefined;
  return (m.length === 2 ? m[1]! : `${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`).toUpperCase();
};

/** Left indent of one level, half an inch. */
const LEVEL_TWIPS = 720;
const TEXT_WIDTH_TWIPS = 9026;

// ── context ─────────────────────────────────────────────────────────────────

interface Ctx {
  opts: ExportOptions;
  warnings: Warnings;
  footnotes: Record<number, { children: Paragraph[] }>;
  footnoteCount: number;
  /** One numbering definition per ordered list, and one for bullets. */
  numbering: { reference: string; levels: ILevelsOptions[] }[];
  listCount: number;
  changeId: number;
  /** Characters of body text written so far, for comment ranges. */
  offset: number;
  comments: { c: ExportComment; id: number; open: boolean; closed: boolean; replyIds: number[] }[];
  /** Inside a header or footer: no pictures, notes or comments. */
  hf: boolean;
}

const BULLET_CHARS = ['•', '◦', '▪', '•', '◦', '▪', '•', '◦', '▪'];

function levelsFor(kind: 'bullet' | 'ordered', format: string | null, type: string | null, start: number, first = 0): ILevelsOptions[] {
  const out: ILevelsOptions[] = [];
  for (let level = 0; level < 9; level++) {
    const indent = { left: LEVEL_TWIPS * (level + 1) - 360 + 360, hanging: 360 };
    if (kind === 'bullet') {
      out.push({ level, format: LevelFormat.BULLET, text: BULLET_CHARS[level]!, style: { paragraph: { indent } } });
      continue;
    }
    if (format === 'legal') {
      const text = Array.from({ length: level + 1 }, (_, i) => `%${i + 1}`).join('.') + (level === 0 ? '.' : '');
      out.push({ level, format: LevelFormat.DECIMAL, text, start: level === first ? start : 1, isLegalNumberingStyle: true, style: { paragraph: { indent } } });
      continue;
    }
    // The editor draws a numbered list in 1. a. i. by depth; a list with its own type starts there.
    const cycle = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN] as const;
    const own = { a: LevelFormat.LOWER_LETTER, A: LevelFormat.UPPER_LETTER, i: LevelFormat.LOWER_ROMAN, I: LevelFormat.UPPER_ROMAN } as const;
    const firstFormat = type && type in own ? own[type as keyof typeof own] : cycle[first % 3]!;
    const firstLevel = first;
    const fmt = level === firstLevel ? firstFormat : cycle[level % 3]!;
    out.push({ level, format: fmt, text: `%${level + 1}.`, start: level === firstLevel ? start : 1, style: { paragraph: { indent } } });
  }
  return out;
}

// ── inline ──────────────────────────────────────────────────────────────────

function runOptions(marks: readonly JSONContent[] | undefined): IRunOptions & { link?: string; change?: { kind: 'ins' | 'del'; id: string; author: string; at: number } } {
  const out: Record<string, unknown> = {};
  let link: string | undefined;
  let change: { kind: 'ins' | 'del'; id: string; author: string; at: number } | undefined;
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'bold':
        out.bold = true;
        break;
      case 'italic':
        out.italics = true;
        break;
      case 'underline':
        out.underline = {};
        break;
      case 'strike':
        out.strike = true;
        break;
      case 'subscript':
        out.subScript = true;
        break;
      case 'superscript':
        out.superScript = true;
        break;
      case 'code':
        out.font = 'Courier New';
        out.shading = { type: ShadingType.CLEAR, fill: 'EEEEF2', color: 'auto' };
        break;
      case 'textStyle': {
        const a = m.attrs ?? {};
        if (typeof a.fontFamily === 'string') out.font = a.fontFamily;
        if (typeof a.fontSize === 'string') {
          const pt = Number.parseFloat(a.fontSize);
          if (Number.isFinite(pt)) out.size = Math.round(pt * 2);
        }
        const color = hex(a.color as string | null);
        if (color) out.color = color;
        break;
      }
      case 'highlight': {
        const fill = hex((m.attrs?.color as string | null) ?? '#fff2a8');
        if (fill) out.shading = { type: ShadingType.CLEAR, fill, color: 'auto' };
        break;
      }
      case 'link':
        if (typeof m.attrs?.href === 'string' && isSafeHref(m.attrs.href)) link = m.attrs.href;
        break;
      case 'insertion':
      case 'deletion':
        change = {
          kind: m.type === 'insertion' ? 'ins' : 'del',
          id: String(m.attrs?.id ?? ''),
          author: String(m.attrs?.authorName ?? 'Unknown'),
          at: Number(m.attrs?.at) || 0
        };
        break;
      default:
        break;
    }
  }
  return { ...out, ...(link ? { link } : {}), ...(change ? { change } : {}) };
}

/** Text with a comment's boundaries cut into it: [text, openers-before, closers-before] per slice. */
function textRuns(ctx: Ctx, t: string, marks: readonly JSONContent[] | undefined, counted = true): ParagraphChild[] {
  const { link, change, ...run } = runOptions(marks);
  const out: ParagraphChild[] = [];
  const emit = (value: string) => {
    if (value === '') return;
    const text = value.replace(/\t/g, '\t');
    let r: ParagraphChild;
    const common = { ...run, ...(link ? { style: 'Hyperlink' } : {}) } as IRunOptions;
    if (change && !ctx.hf) {
      const info = { id: ++ctx.changeId, author: change.author, date: new Date(change.at || ctx.opts.now || Date.now()).toISOString() };
      r = change.kind === 'ins' ? new InsertedTextRun({ ...common, ...info, text }) : new DeletedTextRun({ ...common, ...info, text });
    } else {
      r = new TextRun({ ...common, text });
    }
    out.push(link ? new ExternalHyperlink({ link, children: [r] }) : r);
  };
  // A chip is one character of the page and none of its text; headers have no comments.
  if (ctx.hf || !counted) {
    emit(t);
    return out;
  }
  // Comments open and close between characters; cut the text where they do.
  let at = 0;
  while (at < t.length) {
    out.push(...commentMarkers(ctx));
    const stop = nextBoundary(ctx, ctx.offset + 1, ctx.offset + (t.length - at));
    const take = stop === null ? t.length - at : stop - ctx.offset;
    emit(t.slice(at, at + take));
    at += take;
    ctx.offset += take;
  }
  return out;
}

/** The nearest comment boundary strictly inside (from, to], or null. */
function nextBoundary(ctx: Ctx, from: number, to: number): number | null {
  let best: number | null = null;
  for (const c of ctx.comments) {
    for (const b of [c.c.start, c.c.end]) {
      if (b >= from && b < to && (best === null || b < best)) best = b;
    }
  }
  return best;
}

/** The markers due at the current offset: starts before, ends (with their reference) after. */
function commentMarkers(ctx: Ctx): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const e of ctx.comments) {
    if (!e.closed && e.open && e.c.end <= ctx.offset) {
      out.push(...closeComment(e));
    }
  }
  for (const e of ctx.comments) {
    if (!e.open && e.c.start <= ctx.offset) {
      e.open = true;
      out.push(new CommentRangeStart(e.id));
      for (const r of e.replyIds) out.push(new CommentRangeStart(r));
    }
  }
  return out;
}

function closeComment(e: Ctx['comments'][number]): ParagraphChild[] {
  e.closed = true;
  const out: ParagraphChild[] = [new CommentRangeEnd(e.id), new TextRun({ children: [new CommentReference(e.id)] })];
  for (const r of e.replyIds) out.push(new CommentRangeEnd(r), new TextRun({ children: [new CommentReference(r)] }));
  return out;
}

function inline(ctx: Ctx, nodes: readonly JSONContent[] | undefined): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  const list = nodes ?? [];
  // Adjacent runs of the same link share one hyperlink element.
  for (const n of list) {
    switch (n.type) {
      case 'text':
        out.push(...textRuns(ctx, n.text ?? '', n.marks));
        break;
      case 'hardBreak':
        out.push(new TextRun({ break: 1 }));
        break;
      case 'footnote': {
        const body = textOf(n);
        if (!ctx.hf) out.push(...commentMarkers(ctx));
        if (ctx.hf || !body) break;
        const id = ++ctx.footnoteCount;
        ctx.footnotes[id] = { children: [new Paragraph({ children: [new TextRun({ text: body })] })] };
        out.push(new FootnoteReferenceRun(id));
        ctx.offset += body.length;
        break;
      }
      case 'mention':
        out.push(...textRuns(ctx, `@${String(n.attrs?.label ?? n.attrs?.id ?? '')}`, [], false));
        break;
      case 'dateChip': {
        const raw = String(n.attrs?.date ?? '');
        const d = new Date(raw);
        const shown = Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(d) : raw;
        out.push(...textRuns(ctx, shown, [], false));
        break;
      }
      case 'docLink': {
        const title = String(n.attrs?.title ?? 'Document') || 'Document';
        const origin = ctx.opts.origin;
        const id = String(n.attrs?.docId ?? '');
        const kind = String(n.attrs?.kind ?? 'docs');
        if (origin && id) out.push(...textRuns(ctx, title, [{ type: 'link', attrs: { href: `${origin}/${kind}/${encodeURIComponent(id)}` } }], false));
        else out.push(...textRuns(ctx, title, [], false));
        break;
      }
      case 'pageField':
        out.push(pageField(ctx, String(n.attrs?.kind ?? 'page')));
        break;
      default:
        break;
    }
  }
  return out;
}

function pageField(ctx: Ctx, kind: string): ParagraphChild {
  switch (kind) {
    case 'pages':
      return new TextRun({ children: [PageNumber.TOTAL_PAGES] });
    case 'date':
      return new SimpleField('DATE \\@ "MMMM d, yyyy"', new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(ctx.opts.now ?? Date.now())));
    case 'title':
      return new SimpleField('TITLE', ctx.opts.title);
    default:
      return new TextRun({ children: [PageNumber.CURRENT] });
  }
}

// ── blocks ──────────────────────────────────────────────────────────────────

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type ParaSpec = Mutable<IParagraphOptions>;

const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED } as const;

/** `tight`: a list item, which the editor sets close to the next one and Word would otherwise set an 8 pt gap after. */
function paragraphSpec(ctx: Ctx, node: JSONContent, extra: Partial<ParaSpec> = {}, tight = false): ParaSpec {
  const a = node.attrs ?? {};
  const spec: ParaSpec = { ...extra };
  if (node.type === 'heading') {
    spec.heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][Math.min(6, Math.max(1, Number(a.level) || 1)) - 1];
  } else if (a.paraStyle === 'title') spec.style = 'Title';
  else if (a.paraStyle === 'subtitle') spec.style = 'Subtitle';
  else if (a.paraStyle === 'nospacing') spec.style = 'NoSpacing';

  const align = a.textAlign as keyof typeof ALIGN | undefined;
  if (align && align in ALIGN) spec.alignment = ALIGN[align];

  const spacing: Mutable<NonNullable<IParagraphOptions['spacing']>> = {};
  if (typeof a.spaceBefore === 'number') spacing.before = ptToTwips(a.spaceBefore);
  if (typeof a.spaceAfter === 'number') spacing.after = ptToTwips(a.spaceAfter);
  else if (tight) spacing.after = 0;
  if (typeof a.lineHeight === 'number') {
    spacing.line = Math.round(a.lineHeight * 240);
    spacing.lineRule = LineRuleType.AUTO;
  }
  if (Object.keys(spacing).length > 0) spec.spacing = spacing;
  if (typeof a.indent === 'number' && a.indent > 0 && !extra.numbering) spec.indent = { left: a.indent * LEVEL_TWIPS };
  spec.children = inline(ctx, node.content);
  return spec;
}

interface Flow {
  /** Paragraph specs and finished block objects, in order. */
  items: (ParaSpec | Table)[];
}

const isSpec = (x: ParaSpec | Table): x is ParaSpec => !(x instanceof Table);

function blockSuggest(items: (ParaSpec | Table)[], node: JSONContent, ctx: Ctx): void {
  const s = node.attrs?.suggest as { kind?: string; authorName?: string; at?: number } | null | undefined;
  if (!s || (s.kind !== 'split' && s.kind !== 'join')) return;
  const prev = items[items.length - 1];
  if (!prev || !isSpec(prev)) return;
  const info = { id: ++ctx.changeId, author: String(s.authorName ?? 'Unknown'), date: new Date(s.at || ctx.opts.now || Date.now()).toISOString() };
  prev.run = { ...(prev.run ?? {}), ...(s.kind === 'split' ? { insertion: info } : { deletion: info }) };
}

function blocks(ctx: Ctx, nodes: readonly JSONContent[] | undefined, flow: Flow, o: { quote?: boolean; listDepth?: number } = {}): void {
  for (const n of nodes ?? []) block(ctx, n, flow, o);
}

function block(ctx: Ctx, n: JSONContent, flow: Flow, o: { quote?: boolean; listDepth?: number }): void {
  switch (n.type) {
    case 'paragraph':
    case 'heading': {
      blockSuggest(flow.items, n, ctx);
      flow.items.push(paragraphSpec(ctx, n, o.quote ? { style: 'Quote' } : {}));
      break;
    }
    case 'blockquote':
      blocks(ctx, n.content, flow, { ...o, quote: true });
      break;
    case 'codeBlock': {
      const lines = textOf(n).split('\n');
      lines.forEach((line, i) => {
        flow.items.push({ style: 'Code', children: [new TextRun({ text: line })] });
        // The newline between two lines is a character of the page's text.
        ctx.offset += line.length + (i < lines.length - 1 ? 1 : 0);
      });
      break;
    }
    case 'horizontalRule':
      flow.items.push({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 1 } } });
      break;
    case 'pageBreak':
      flow.items.push({ children: [new PageBreak()] });
      break;
    case 'tableOfContents': {
      const entries = JSON.parse(String(n.attrs?.entries ?? '[]')) as { level: number; text: string }[];
      flow.items.push({ style: 'Heading2', children: [new TextRun({ text: 'Contents' })] });
      for (const e of Array.isArray(entries) ? entries : []) {
        flow.items.push({ indent: { left: (Math.max(1, Number(e.level) || 1) - 1) * 360 }, children: [new TextRun({ text: String(e.text ?? '') })] });
      }
      break;
    }
    case 'image':
      image(ctx, n, flow);
      break;
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      list(ctx, n, flow, o.listDepth ?? 0, null);
      break;
    case 'table':
      flow.items.push(tableOf(ctx, n));
      break;
    default:
      // A node this writer does not know is its text, so nothing typed is lost.
      if (textOf(n)) flow.items.push({ children: [new TextRun({ text: textOf(n) })] });
  }
}

function image(ctx: Ctx, n: JSONContent, flow: Flow): void {
  if (ctx.hf) return;
  const src = String(n.attrs?.src ?? '');
  const img: ImageData | null = ctx.opts.resolveImage?.(src) ?? null;
  const type = img ? ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' } as Record<string, 'png' | 'jpg' | 'gif'>)[img.mime] : undefined;
  if (!img || !type) {
    ctx.warnings.add('picture', (c) => `${plural(c, 'picture')} could not be included.`);
    return;
  }
  const natural = imageSize(img.bytes);
  let width = Number(n.attrs?.width) || natural?.width || 400;
  let height = Number(n.attrs?.height) || natural?.height || 300;
  // Word's text column is about 6 inches; a larger picture is scaled to fit it.
  const max = 624;
  if (width > max) {
    height = Math.round((height * max) / width);
    width = max;
  }
  const align = n.attrs?.align as keyof typeof ALIGN | undefined;
  const alt = String(n.attrs?.alt ?? '');
  flow.items.push({
    ...(align && align in ALIGN ? { alignment: ALIGN[align] } : {}),
    children: [
      new ImageRun({
        type,
        data: img.bytes,
        transformation: { width, height },
        altText: { name: img.name.slice(0, 100) || 'Picture', description: alt, title: alt }
      })
    ]
  });
}

// ── lists ───────────────────────────────────────────────────────────────────

function list(ctx: Ctx, n: JSONContent, flow: Flow, depth: number, reference: string | null): void {
  const task = n.type === 'taskList';
  let ref = reference;
  if (!ref) {
    if (n.type === 'orderedList') {
      ref = `ol-${++ctx.listCount}`;
      ctx.numbering.push({
        reference: ref,
        levels: levelsFor('ordered', (n.attrs?.format as string | null) ?? null, (n.attrs?.type as string | null) ?? null, Number(n.attrs?.start) || 1, depth)
      });
    } else {
      ref = 'bullets';
      if (!ctx.numbering.some((x) => x.reference === 'bullets')) ctx.numbering.push({ reference: 'bullets', levels: levelsFor('bullet', null, null, 1) });
    }
  }
  for (const item of n.content ?? []) {
    const [first, ...rest] = item.content ?? [];
    if (first && (first.type === 'paragraph' || first.type === 'heading')) {
      blockSuggest(flow.items, first, ctx);
      const mark = task ? (item.attrs?.checked ? '☑ ' : '☐ ') : '';
      const spec = paragraphSpec(ctx, first, task ? { indent: { left: LEVEL_TWIPS * (depth + 1), hanging: 360 } } : { numbering: { reference: ref, level: Math.min(depth, 8) } }, true);
      if (mark) spec.children = [new TextRun({ text: mark }), ...(spec.children ?? [])];
      flow.items.push(spec);
    }
    for (const r of rest) {
      if (r.type === 'bulletList' || r.type === 'orderedList' || r.type === 'taskList') list(ctx, r, flow, depth + 1, r.type === n.type ? ref : null);
      else block(ctx, r, flow, { listDepth: depth + 1 });
    }
  }
}

// ── tables ──────────────────────────────────────────────────────────────────

function tableOf(ctx: Ctx, t: JSONContent): Table {
  const rows = t.content ?? [];
  // The grid comes from the first row's widths where it has them, else the text column split evenly.
  const firstRow = rows[0]?.content ?? [];
  const cols = firstRow.reduce((n, c) => n + (Number(c.attrs?.colspan) || 1), 0) || 1;
  const widths: number[] = [];
  for (const c of firstRow) {
    const span = Number(c.attrs?.colspan) || 1;
    const w = Array.isArray(c.attrs?.colwidth) ? (c.attrs.colwidth as number[]) : [];
    for (let i = 0; i < span; i++) widths.push(w[i] ? pxToTwips(w[i]!) : Math.floor(TEXT_WIDTH_TWIPS / cols));
  }
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
  const built = rows.map((row) => {
    const cells = (row.content ?? []).map((cell, ci) => {
      const flow: Flow = { items: [] };
      blocks(ctx, cell.content, flow);
      let kids = flow.items.map((x) => (isSpec(x) ? new Paragraph(x) : x));
      if (kids.length === 0 || kids[kids.length - 1] instanceof Table) kids = [...kids, new Paragraph({ children: [] })];
      const span = Number(cell.attrs?.colspan) || 1;
      const rowSpan = Number(cell.attrs?.rowspan) || 1;
      const fill = hex(cell.attrs?.backgroundColor as string | null);
      void ci;
      return new TableCell({
        children: kids as (Paragraph | Table)[],
        ...(span > 1 ? { columnSpan: span } : {}),
        ...(rowSpan > 1 ? { rowSpan } : {}),
        ...(fill ? { shading: { type: ShadingType.CLEAR, fill, color: 'auto' } } : {}),
        borders: { top: border, bottom: border, left: border, right: border }
      });
    });
    return new TableRow({ children: cells, tableHeader: (row.content ?? []).every((c) => c.type === 'tableHeader') && (row.content ?? []).length > 0 });
  });
  void VerticalMergeType;
  return new Table({ rows: built, width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: widths.length ? widths : undefined });
}

// ── headers and footers ─────────────────────────────────────────────────────

function hfParagraphs(ctx: Ctx, d: JSONContent | undefined): Paragraph[] {
  if (!d) return [];
  const saved = { hf: ctx.hf, offset: ctx.offset };
  ctx.hf = true;
  const out = (d.content ?? []).filter((n) => n.type === 'paragraph').map((n) => new Paragraph(paragraphSpec(ctx, n)));
  ctx.hf = saved.hf;
  ctx.offset = saved.offset;
  return out;
}

// ── the document ────────────────────────────────────────────────────────────

const HEADING_SIZES = [32, 26, 24, 22, 22, 22];

export async function writeDocx(model: DocModel, opts: ExportOptions): Promise<{ bytes: Uint8Array; warnings: Warning[] }> {
  const ctx: Ctx = {
    opts,
    warnings: new Warnings(),
    footnotes: {},
    footnoteCount: 0,
    numbering: [],
    listCount: 0,
    changeId: 0,
    offset: 0,
    comments: [],
    hf: false
  };

  // Comments: ids are numbers in the file, and a reply is its own comment with the same range.
  let cid = 0;
  for (const c of opts.comments ?? []) {
    const id = ++cid;
    ctx.comments.push({ c, id, open: false, closed: false, replyIds: c.replies.map(() => ++cid) });
  }

  const flow: Flow = { items: [] };
  blocks(ctx, model.body.content, flow);
  // Comments still open when the text ends close at the last paragraph.
  const tail = ctx.comments.filter((e) => !e.closed).flatMap((e) => (e.open ? closeComment(e) : [...[new CommentRangeStart(e.id)], ...closeComment(e)]));
  if (tail.length > 0) {
    const last = [...flow.items].reverse().find(isSpec);
    if (last) last.children = [...(last.children ?? []), ...tail];
    else flow.items.push({ children: tail });
  }
  const children: FileChild[] = flow.items.map((x) => (isSpec(x) ? new Paragraph(x) : x));
  if (children.length === 0) children.push(new Paragraph({ children: [] }));

  const page: PageSetup | null = model.page ? { ...defaultSetup(model.page.size), ...model.page, margins: model.page.margins, paged: true } : null;
  const paper = PAPER[page?.size ?? defaultSetup().size];
  const header = hfParagraphs(ctx, model.header.default);
  const headerFirst = hfParagraphs(ctx, model.header.first);
  const footer = hfParagraphs(ctx, model.footer.default);
  const footerFirst = hfParagraphs(ctx, model.footer.first);

  const font = 'Calibri';
  const file = new Document({
    creator: 'Office',
    title: opts.title,
    numbering: { config: ctx.numbering.map((x) => ({ reference: x.reference, levels: x.levels })) },
    comments: {
      children: ctx.comments.flatMap((e) => [
        commentOf(e.c.author, e.c.at, e.c.text, e.id, undefined, e.c.resolved),
        ...e.c.replies.map((r, i) => commentOf(r.author, r.at, r.text, e.replyIds[i]!, e.id, false))
      ])
    },
    footnotes: ctx.footnotes,
    styles: {
      default: {
        document: { run: { font, size: 22 }, paragraph: { spacing: { after: 160, line: 259 } } },
        title: { run: { font, size: 56, bold: true }, paragraph: { spacing: { after: 120 } } },
        heading1: { run: { font, size: HEADING_SIZES[0]!, bold: true }, paragraph: { spacing: { before: 360, after: 120 } } },
        heading2: { run: { font, size: HEADING_SIZES[1]!, bold: true }, paragraph: { spacing: { before: 280, after: 100 } } },
        heading3: { run: { font, size: HEADING_SIZES[2]!, bold: true }, paragraph: { spacing: { before: 240, after: 80 } } },
        heading4: { run: { font, size: HEADING_SIZES[3]!, bold: true }, paragraph: { spacing: { before: 200, after: 60 } } },
        heading5: { run: { font, size: HEADING_SIZES[4]!, bold: true } },
        heading6: { run: { font, size: HEADING_SIZES[5]!, bold: true } }
      },
      paragraphStyles: [
        { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, color: '666666' } },
        { id: 'NoSpacing', name: 'No Spacing', basedOn: 'Normal', quickFormat: true, paragraph: { spacing: { after: 0, line: 240 } } },
        {
          id: 'Quote',
          name: 'Quote',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { italics: true, color: '555555' },
          paragraph: { indent: { left: 720, right: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: '9DBCFB', space: 8 } } }
        },
        {
          id: 'Code',
          name: 'Code',
          basedOn: 'Normal',
          quickFormat: true,
          run: { font: 'Courier New', size: 20 },
          paragraph: { spacing: { after: 0, line: 240 }, shading: { type: ShadingType.CLEAR, fill: 'F1F3F9', color: 'auto' } }
        }
      ]
    },
    sections: [
      {
        properties: {
          titlePage: page?.differentFirst ?? false,
          page: {
            size: {
              width: mmToTwips(paper.w),
              height: mmToTwips(paper.h),
              orientation: page?.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT
            },
            margin: {
              top: mmToTwips(page?.margins.top ?? 25.4),
              right: mmToTwips(page?.margins.right ?? 25.4),
              bottom: mmToTwips(page?.margins.bottom ?? 25.4),
              left: mmToTwips(page?.margins.left ?? 25.4),
              header: mmToTwips(page?.headerDistance ?? 12.7),
              footer: mmToTwips(page?.footerDistance ?? 12.7)
            }
          }
        },
        headers: {
          ...(header.length ? { default: new Header({ children: header }) } : {}),
          ...(headerFirst.length ? { first: new Header({ children: headerFirst }) } : {})
        },
        footers: {
          ...(footer.length ? { default: new Footer({ children: footer }) } : {}),
          ...(footerFirst.length ? { first: new Footer({ children: footerFirst }) } : {})
        },
        children
      }
    ]
  });
  const bytes = await Packer.pack(file, 'uint8array');
  void headingEntries;
  return { bytes, warnings: ctx.warnings.list() };
}

function commentOf(author: string, at: number | null, text: string, id: number, parentId: number | undefined, resolved: boolean) {
  return {
    id,
    author: author || 'Unknown',
    initials: (author || 'U')
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 3)
      .toUpperCase(),
    date: new Date(at ?? Date.now()),
    ...(parentId !== undefined ? { parentId } : {}),
    ...(resolved ? { resolved: true } : {}),
    children: text.split('\n').map((line) => new Paragraph({ children: [new TextRun({ text: line })] }))
  };
}
