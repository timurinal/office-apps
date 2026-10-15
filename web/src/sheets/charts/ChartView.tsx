/**
 * One chart on screen: the SVG, the tween between its versions, and the readout under a pointer.
 *
 * It knows nothing of the grid or the model; the card (ChartCard.tsx) puts it where it goes. Its
 * hover is imperative on purpose: a pointer moving over a chart changes a hairline and a tooltip,
 * which are not React's business sixty times a second.
 */

import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { play } from './animate';
import type { ChartGeom } from './layout';
import { ChartSvg } from './render';
import { ChartTip } from './tooltip';

export const ChartView = memo(function ChartView({ geom, svgRef }: { geom: ChartGeom; svgRef?: React.MutableRefObject<SVGSVGElement | null> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const prev = useRef<ChartGeom | null>(null);
  const tip = useRef<ChartTip | null>(null);
  const latest = useRef(geom);
  latest.current = geom;

  // A changed chart plays from what was there to what is; the cleanup is what stops it when another change arrives.
  useLayoutEffect(() => {
    const el = svg.current;
    const before = prev.current;
    prev.current = geom;
    if (!el || !before || before === geom) return;
    return play(el, before, geom);
  }, [geom]);

  useEffect(() => {
    const host = wrap.current;
    if (!host) return;
    const t = (tip.current = new ChartTip(host));
    return () => {
      t.destroy();
      tip.current = null;
    };
  }, []);

  const hover = (e: React.PointerEvent<HTMLDivElement>) => {
    const host = wrap.current;
    const t = tip.current;
    const el = svg.current;
    if (!host || !t || !el) return;
    const hit = (e.target as Element).closest?.('[data-tip]');
    const guide = el.querySelector<SVGLineElement>('[data-guide]');
    const g = latest.current;
    const info = hit ? g.tips[Number(hit.getAttribute('data-tip'))] : undefined;
    if (!hit || !info) {
      t.hide();
      guide?.setAttribute('visibility', 'hidden');
      return;
    }
    // The card may be zoomed: pointer positions are screen pixels, the tooltip lives in chart pixels.
    const r = host.getBoundingClientRect();
    const k = r.width / g.w || 1;
    t.show(info, (e.clientX - r.left) / k, (e.clientY - r.top) / k, { w: g.w, h: g.h });
    const x = hit.getAttribute('data-guide');
    if (guide && x !== null) {
      guide.setAttribute('x1', x);
      guide.setAttribute('x2', x);
      guide.setAttribute('visibility', 'visible');
    } else guide?.setAttribute('visibility', 'hidden');
  };

  const leave = () => {
    tip.current?.hide();
    svg.current?.querySelector('[data-guide]')?.setAttribute('visibility', 'hidden');
  };

  return (
    <div ref={wrap} className="oac-plot" style={{ width: geom.w, height: geom.h }} onPointerMove={hover} onPointerLeave={leave}>
      <ChartSvg
        geom={geom}
        svgRef={(el) => {
          svg.current = el;
          if (svgRef) svgRef.current = el;
        }}
      />
    </div>
  );
});
