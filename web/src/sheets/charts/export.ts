/**
 * A chart as a file: the SVG it is drawn with, or a PNG made from that.
 *
 * The SVG on the page is already standalone (render.tsx uses presentation attributes only), so
 * exporting it is a copy with the hover layer taken out. The PNG is that SVG drawn on a canvas at
 * twice its size and on white, which is what a chart pasted into another document wants.
 * Nothing is uploaded: the file is made and saved here.
 *
 * `pngBytes` is also what Slides' "Save as picture" draws its PNG with (slides/export), on no
 * background at all.
 */

import { fileNameOf, save } from '../../formats/browser/saveFile';

/** The SVG's text, without the layer that answers a pointer, and with the XML declaration a file wants. */
export function svgText(svg: SVGSVGElement): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  for (const n of copy.querySelectorAll('[data-hit]')) n.remove();
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}`;
}

/**
 * The SVG drawn at `scale` times its size as PNG bytes, on a canvas filled with `background` (white
 * unless told otherwise; null leaves it transparent). Null where the browser cannot.
 */
export async function pngBytes(text: string, w: number, h: number, scale = 2, background: string | null = '#ffffff'): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null;
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The chart could not be drawn.'));
    });
    img.src = url;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Saves the chart on the page as a PNG or an SVG, named for its title. False when it could not be made. */
export async function downloadChart(svg: SVGSVGElement, title: string, format: 'png' | 'svg'): Promise<boolean> {
  const text = svgText(svg);
  const name = fileNameOf(title.trim() || 'Chart', format);
  if (format === 'svg') {
    save(new TextEncoder().encode(text), 'image/svg+xml', name);
    return true;
  }
  const w = Number(svg.getAttribute('width')) || svg.clientWidth;
  const h = Number(svg.getAttribute('height')) || svg.clientHeight;
  const bytes = await pngBytes(text, w, h);
  if (!bytes) return false;
  save(bytes, 'image/png', name);
  return true;
}
