import type { DocKind } from '@shared/api';
import './skeleton.css';

/**
 * What the editor looks like before it has loaded: the desk in the app's colour, the
 * banner's glass, and the paper. It is drawn in the main chunk, so it is on screen
 * the frame a card is pressed on Home, and the real shell lands exactly over it.
 *
 * It is also where Home's card morphs to, through View Transitions: the paper is
 * `data-doc-page`, the same marker the editor's page wears. Sheets draws the grid's lines in
 * that place instead (`oa-skel-grid`, in skeleton.css).
 *
 * Without a kind (a link, before it has said what it opens) it is a page on the suite's ground.
 */
export function DocumentSkeleton({ kind }: { kind?: DocKind }) {
  // Sheets' grid runs full-bleed under the banner, so its outline is the grid's lines, not a sheet of paper.
  if (kind === 'sheets') {
    return (
      <div className="oa-skel" data-app="sheets" role="status" aria-busy="true" aria-label="Loading">
        <div className="oa-skel-banner oa-skel-banner-sheets glass" />
        <div className="oa-skel-grid oa-skel-lines" data-doc-page="true" />
      </div>
    );
  }
  return (
    <div className="oa-skel" data-app={kind} {...(kind === 'slides' ? { 'data-theme': 'dark' } : {})} role="status" aria-busy="true" aria-label="Loading">
      <div className="oa-skel-banner glass" />
      <div className="oa-skel-stage">
        <div className="oa-skel-paper" data-doc-page="true" />
      </div>
    </div>
  );
}
