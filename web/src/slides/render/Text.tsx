/**
 * A text body, drawn: paragraphs with the cascade's style, bullets and numbers per level, the
 * anchor and the insets, and autofit's shrink.
 *
 * Shrink measures once per change of the text or the box and scales: the body is laid out wider
 * by the same factor it is scaled down by, so it rewraps into the room it has, as PowerPoint's
 * font scale does. The factor is kept beside the text's own object, so a thumbnail, the canvas and
 * the next render of an unchanged box do not measure again.
 */

import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isSafeHref } from '../../docs/core/links';
import type { TextBox, TextDoc, TextNode, ThemeJSON } from '../model/deck';
import { bulletLabels, paragraphStyle, parasOf, type ResolvedStyle } from '../model/styles';
import { anchorCss, bulletCss, insetsOf, paragraphCss, reactStyle, runCss, withNumber } from './paint';

export type RenderMode = 'thumb' | 'edit' | 'present';

export interface TextProps {
  doc: TextDoc | undefined;
  /** What a paragraph at a level inherits. */
  styleAt: (level: number) => ResolvedStyle;
  theme: ThemeJSON;
  mode: RenderMode;
  /** The slide's number, for the slide-number placeholder. */
  number?: number;
  /** Layout the paragraphs only, with no frame: a table cell. */
  bare?: boolean;
  box?: TextBox;
  w?: number;
  h?: number;
  className?: string;
}

function Runs({ nodes, theme, mode, number }: { nodes: readonly TextNode[]; theme: ThemeJSON; mode: RenderMode; number?: number }) {
  const out: ReactNode[] = [];
  nodes.forEach((n, i) => {
    if (n.type === 'hardBreak') {
      out.push(<br key={i} />);
      return;
    }
    if (n.type !== 'text' || typeof n.text !== 'string') return;
    const { css, href } = runCss(n.marks, theme);
    const text = withNumber(n.text, number);
    const style = Object.keys(css).length ? reactStyle(css) : undefined;
    if (href && mode === 'present' && isSafeHref(href)) {
      out.push(
        <a key={i} href={href} target="_blank" rel="noopener noreferrer nofollow" style={style}>
          {text}
        </a>
      );
    } else {
      out.push(
        <span key={i} style={style}>
          {text}
        </span>
      );
    }
  });
  return <>{out}</>;
}

/** The paragraphs of a body, each with its style and its bullet. */
export function Paragraphs({ doc, styleAt, theme, mode, number }: Pick<TextProps, 'doc' | 'styleAt' | 'theme' | 'mode' | 'number'>) {
  const paras = doc?.content ?? [];
  const styleOf = (attrs: Record<string, unknown> | undefined) => paragraphStyle(styleAt, attrs);
  const labels = bulletLabels(parasOf(doc), styleOf);
  return (
    <>
      {paras.map((p, i) => {
        const s = styleOf(p.attrs);
        const label = labels[i] ?? null;
        const content = p.content ?? [];
        const last = content[content.length - 1];
        return (
          <p key={i} className="sl-p" style={reactStyle(paragraphCss(s, theme, i === 0))}>
            {label && (
              <span className="sl-bullet" aria-hidden="true" style={reactStyle(bulletCss(label, s, theme))}>
                {label.text}
              </span>
            )}
            <Runs nodes={content} theme={theme} mode={mode} number={number} />
            {(content.length === 0 || last?.type === 'hardBreak') && <br />}
          </p>
        );
      })}
    </>
  );
}

interface Shrink {
  key: string;
  k: number;
  /** The body's height once scaled, for the anchor to place it. */
  h: number;
}

const shrinks = new WeakMap<object, Shrink>();

/** The factor a shrink box was last drawn at, for the text editor to draw its text the same size. */
export function shrinkOf(doc: TextDoc | undefined, key: string): number {
  if (!doc) return 1;
  const hit = shrinks.get(doc);
  return hit && hit.key === key ? hit.k : 1;
}

/** What a shrink factor depends on besides the text: the box and the type the cascade gives it. */
export function shrinkKey(w: number, h: number, box: TextBox | undefined, base: ResolvedStyle): string {
  const i = insetsOf(box);
  return `${w}|${h}|${i.l},${i.t},${i.r},${i.b}|${base.fontFamily}|${base.fontSize}|${base.lineHeight}`;
}

/** A text body in its frame: insets, anchor, wrap and autofit. */
export const TextFrame = memo(function TextFrame(p: TextProps) {
  const { doc, box, w = 0, h = 0 } = p;
  const insets = insetsOf(box);
  const shrink = box?.autofit === 'shrink';
  const key = shrinkKey(w, h, box, p.styleAt(0));
  const cached = shrink && doc ? shrinks.get(doc) : undefined;
  const [fit, setFit] = useState<Shrink | null>(cached && cached.key === key ? cached : null);
  const inner = useRef<HTMLDivElement>(null);
  const room = Math.max(1, h - insets.t - insets.b);

  useLayoutEffect(() => {
    if (!shrink || !doc) {
      if (fit) setFit(null);
      return;
    }
    const hit = shrinks.get(doc);
    if (hit && hit.key === key) {
      if (fit !== hit) setFit(hit);
      return;
    }
    const el = inner.current;
    if (!el) return;
    // Measure at full size, then once more laid out wider by the factor.
    const before = { width: el.style.width, transform: el.style.transform, position: el.style.position };
    el.style.width = '100%';
    el.style.transform = 'none';
    el.style.position = 'static';
    const natural = el.scrollHeight;
    let next: Shrink = { key, k: 1, h: natural };
    if (natural > room + 0.5) {
      const k = Math.max(0.25, Math.floor((room / natural) * 100) / 100);
      el.style.width = `${100 / k}%`;
      next = { key, k, h: Math.min(room, el.scrollHeight * k) };
    }
    Object.assign(el.style, before);
    shrinks.set(doc, next);
    setFit(next);
    // `fit` is what this sets, not an input.
  }, [shrink, doc, key, room]);

  const body = <Paragraphs doc={doc} styleAt={p.styleAt} theme={p.theme} mode={p.mode} number={p.number} />;
  const wrap = box?.wrap === false ? 'sl-text sl-nowrap' : 'sl-text';
  const scaled = fit && fit.k < 1;
  return (
    <div
      className={p.className ? `sl-frame ${p.className}` : 'sl-frame'}
      style={{ padding: `${insets.t}px ${insets.r}px ${insets.b}px ${insets.l}px`, justifyContent: anchorCss(box?.anchor) }}
    >
      {scaled ? (
        <div className="sl-fit" style={{ height: fit.h }}>
          <div ref={inner} className={wrap} style={{ position: 'absolute', width: `${100 / fit.k}%`, transform: `scale(${fit.k})` }}>
            {body}
          </div>
        </div>
      ) : (
        <div ref={inner} className={wrap}>
          {body}
        </div>
      )}
    </div>
  );
});
