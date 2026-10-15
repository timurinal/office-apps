/**
 * A slide drawn small, once it is scrolled near the view: a deck of 300 slides draws the dozen in
 * sight and the rest as their background, until they are reached. Once drawn, a thumbnail stays
 * drawn, so scrolling back is free.
 */

import { memo, useEffect, useRef, useState } from 'react';
import type { Aspect, SlideJSON } from '../model/deck';
import type { Design } from '../model/styles';
import { SlideView, slideHeight } from './SlideView';

export interface ThumbnailProps {
  design: Design & { size: Aspect };
  slide: SlideJSON;
  /** CSS px. */
  width: number;
  number: number;
  /** Draw now, without waiting to be seen: a thumbnail already in view, a print. */
  eager?: boolean;
}

/** Thumbnails start drawing this far before they scroll into view. */
const AHEAD = '600px 0px';

export const Thumbnail = memo(function Thumbnail({ design, slide, width, number, eager = false }: ThumbnailProps) {
  const [seen, setSeen] = useState(eager || typeof IntersectionObserver === 'undefined');
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (seen || !host.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: AHEAD }
    );
    io.observe(host.current);
    return () => io.disconnect();
  }, [seen]);
  const height = (slideHeight(design.size) * width) / 1920;
  if (!seen) return <div ref={host} className="sl-view sl-thumb-wait" style={{ width, height }} aria-hidden="true" />;
  return <SlideView design={design} slide={slide} width={width} number={number} mode="thumb" />;
});
