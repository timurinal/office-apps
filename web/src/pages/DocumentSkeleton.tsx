import type { DocKind } from '@shared/api';
import { useEditorTheme } from '../core/appearance';
import './skeleton.css';

/**
 * What the editor looks like before it has loaded: the desk in the app's colour, the
 * banner's glass, and the paper. It is drawn in the main chunk, so it is on screen
 * the frame a card is pressed on Home, and the real shell lands exactly over it.
 *
 * It is also where Home's card morphs to, through View Transitions: the paper is
 * `data-doc-page`, the same marker the editor's page wears. Sheets draws the grid's lines in
 * that place instead (`oa-skel-grid`, in skeleton.css), and Slides the slide on its desk, which is dark unless the reader chose Light.
 *
 * Without a kind (a link, before it has said what it opens) it is a page on the suite's ground.
 */
export function DocumentSkeleton({ kind }: { kind?: DocKind }) {
  // The outline wears the theme the editor will, or the swap is a flash: Slides is dark unless Light was chosen.
  const theme = useEditorTheme(kind);
  // Sheets' grid runs full-bleed under the banner, so its outline is the grid's lines, not a sheet of paper.
  if (kind === 'sheets') {
    return (
      <div className="oa-skel" data-app="sheets" role="status" aria-busy="true" aria-label="Loading">
        <div className="oa-skel-banner oa-skel-banner-sheets glass" />
        <div className="oa-skel-grid oa-skel-lines" data-doc-page="true" />
      </div>
    );
  }
  // Slides is the slide list down the left and the slide fitted to the room beside it, over its notes.
  if (kind === 'slides') {
    return (
      <div className="oa-skel" data-app="slides" {...(theme ? { 'data-theme': theme } : {})} role="status" aria-busy="true" aria-label="Loading">
        <div className="oa-skel-banner glass" />
        <div className="oa-skel-slides">
          <div className="oa-skel-rail">
            <div className="oa-skel-thumb" />
            <div className="oa-skel-thumb" />
            <div className="oa-skel-thumb" />
          </div>
          <div className="oa-skel-main">
            <div className="oa-skel-desk">
              <div className="oa-skel-slide" data-doc-page="true" />
            </div>
            <div className="oa-skel-notes" />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="oa-skel" data-app={kind} role="status" aria-busy="true" aria-label="Loading">
      <div className="oa-skel-banner glass" />
      <div className="oa-skel-stage">
        <div className="oa-skel-paper" data-doc-page="true" />
      </div>
    </div>
  );
}
