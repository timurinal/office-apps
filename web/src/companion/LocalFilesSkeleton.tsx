import { SkeletonRows } from '../core/ui';

/** "On this PC" before the shell has answered. Home draws it eagerly, while the section's own code loads. */
export function LocalFilesSkeleton() {
  return (
    <section aria-labelledby="oa-local-h" className="oa-home-panel">
      <div className="oa-home-list-head">
        <h2 id="oa-local-h" className="oa-home-h">
          On this PC
        </h2>
      </div>
      <SkeletonRows count={3} />
    </section>
  );
}
