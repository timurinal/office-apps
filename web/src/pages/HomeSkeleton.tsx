import { Wordmark } from '../components/Wordmark';
import { Bone } from '../core/ui';
import { RAIL, VIEW_HEADING } from '../home/home';

/**
 * Home before the account has answered: its outline, in Home's own classes, so the page lands
 * on it without a jump. What is the same for everyone is drawn (the lockup, the menus, the
 * headings); what depends on the reader is a placeholder.
 */
export function HomeSkeleton() {
  return (
    <div className="oa-home" role="status" aria-busy="true" aria-label="Loading">
      <div className="oa-home-hd">
        <span className="oa-home-brand">
          <Wordmark />
        </span>
        <span className="oa-home-nav hide-sm">
          {['File', 'View', 'Help'].map((m) => (
            <span key={m} className="oa-home-menu">
              {m}
            </span>
          ))}
        </span>
        <span className="oa-home-search">
          <Bone w="100%" h={30} r={8} />
        </span>
        <Bone w={92} h={32} r={8} className="hide-sm" />
        <Bone w={74} h={32} r={8} />
        <Bone w={30} h={30} r={15} />
      </div>

      <div className="oa-home-body">
        <div className="oa-rail hide-sm">
          {RAIL.map((r) => (
            <span key={r.value} className="oa-rail-item">
              <Bone w={20} h={20} r={6} />
            </span>
          ))}
          <span style={{ flex: 1 }} />
          <span className="oa-rail-item oa-rail-gear">
            <Bone w={20} h={20} r={6} />
          </span>
        </div>

        <div className="oa-home-main">
          <div className="oa-home-views">
            {RAIL.map((r) => (
              <Bone key={r.value} w={72} h={30} r={15} />
            ))}
          </div>

          <div className="oa-home-panel">
            <div className="oa-home-panel-head">
              <span className="oa-home-h">Start something new.</span>
              <span style={{ display: 'flex', gap: 20, paddingBottom: 12 }}>
                <Bone w={66} />
                <Bone w={36} />
              </span>
            </div>
            <div className="oa-tgrid" data-row="true">
              {Array.from({ length: 7 }, (_, i) => (
                // Not `.oa-tcard`, which the walks wait for as the real shelf.
                <span key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span className="oa-tcard-thumb oa-skel-pulse" />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '4px 0' }}>
                    <Bone w="64%" h={11} />
                    <Bone w="30%" h={9} />
                  </span>
                </span>
              ))}
            </div>
          </div>

          <div className="oa-home-panel oa-home-list">
            <div className="oa-home-list-head">
              <span className="oa-home-h">{VIEW_HEADING.recent}</span>
              <span className="oa-home-chips">
                {[42, 56, 68, 64].map((w) => (
                  <Bone key={w} w={w} h={30} r={15} />
                ))}
              </span>
              <span style={{ flex: 1 }} />
              <Bone w={168} h={32} r={8} />
              <Bone w={70} h={32} r={8} />
            </div>
            <div className="oa-cgrid">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="oa-skel-card" />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="oa-home-foot" />
    </div>
  );
}
