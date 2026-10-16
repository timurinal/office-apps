/**
 * The presenter's view: the slide that is on screen, the next one, the speaker notes, a timer and
 * the clock, in the editor's window, while the audience's window shows the slide and nothing else.
 *
 * The two windows are one show (`useShow`): a key in either goes to both, the laser moved here is
 * a dot there. Ending the show here closes the audience's window; ending it there (Escape) ends it
 * here; closing the audience's window by hand leaves the show running, and this view offers to open
 * it again.
 *
 * What the audience sees when it is not the slide is said across the slide here, large (`ScreenBanner`),
 * since the copy of the slide in this window stays on view. Whether the audience's window is full
 * screen is said in the bar, from what that window reports; this window cannot make another full screen,
 * so it only says how.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from '../../core/controls';
import { arrowLeftIcon, arrowRightIcon, eyeSlashIcon, minusIcon, plusIcon, xIcon } from '../../core/icons';
import type { SlideModel } from '../model/model';
import { SlideView, slideHeight } from '../render/SlideView';
import { playIcon } from '../modules/icons';
import { useDeckSlice, useSlide } from '../useSlideModel';
import { useFullscreen } from './fullscreen';
import { arrowClockwiseIcon, cursorIcon, pauseIcon } from './icons';
import type { Launch } from './launch';
import { Live } from './Live';
import { noteLines } from './notes';
import { channelName, newShowToken, type ChannelFactory } from './protocol';
import { useLeave, type HostProps } from './SlideShow';
import type { Screen, ShowAction } from './state';
import { nextVisible } from './stepping';
import { Stopwatch, formatElapsed } from './timer';
import { useShow, viewOf, type ShowHandle } from './useShow';
import { useShowKeys } from './useShowKeys';
import { useSize } from './useSize';
import { audienceUrl, openAudienceWindow } from './window';
import { POPUP_BLOCKED } from './start';

const SIZE_KEY = 'oa-slides-notes-size';
/** The notes' type in px: the range and the step. */
export const NOTES_SIZE = { min: 14, max: 48, step: 2, initial: 22 } as const;

const clampSize = (n: number): number => Math.max(NOTES_SIZE.min, Math.min(NOTES_SIZE.max, Math.round(n)));

function storedSize(): number {
  try {
    const v = Number(localStorage.getItem(SIZE_KEY));
    return v ? clampSize(v) : NOTES_SIZE.initial;
  } catch {
    return NOTES_SIZE.initial;
  }
}

function useNotesSize(): [number, (n: number) => void] {
  const [size, set] = useState(storedSize);
  const change = useCallback((n: number) => {
    const next = clampSize(n);
    set(next);
    try {
      localStorage.setItem(SIZE_KEY, String(next));
    } catch {
      // Not remembered; it still changes.
    }
  }, []);
  return [size, change];
}

/** The slide after this one that is not hidden. Null at the end. */
function nextId(model: SlideModel, id: string | null): string | null {
  const v = viewOf(model);
  const at = id ? v.ids.indexOf(id) : -1;
  const n = nextVisible(v, at);
  return n === null ? null : (v.ids[n] ?? null);
}

/** Ticks once a second, so the clock and the timer are the only parts that redraw. */
function useTick(ms = 1000): void {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function Timer({ watch, onPressed }: { watch: Stopwatch; onPressed: () => void }) {
  useTick();
  const [, force] = useState(0);
  const running = watch.running;
  return (
    <span className="sp-bar-group">
      <span className="sp-time" role="timer" aria-label="Time elapsed">
        {formatElapsed(watch.elapsed())}
      </span>
      <IconButton
        icon={running ? pauseIcon : playIcon}
        label={running ? 'Pause timer' : 'Resume timer'}
        size="sm"
        onClick={() => {
          watch.toggle();
          force((n) => n + 1);
          onPressed();
        }}
      />
      <IconButton
        icon={arrowClockwiseIcon}
        label="Reset timer"
        size="sm"
        onClick={() => {
          watch.reset();
          force((n) => n + 1);
          onPressed();
        }}
      />
    </span>
  );
}

function Clock() {
  useTick(10_000);
  return <span className="sp-clock">{new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>;
}

type Blank = Exclude<Screen, 'none'>;

/** What each blanked screen is called here, the key that brings the slide back, and what Resume does: the same. */
const BLANKS: Record<Blank, { title: string; key: string; how: string; back: ShowAction }> = {
  black: { title: 'Black screen', key: 'B', how: 'to resume', back: { type: 'screen', screen: 'black' } },
  white: { title: 'White screen', key: 'W', how: 'to resume', back: { type: 'screen', screen: 'white' } },
  // Next from here leaves the show; Previous is the way back.
  end: { title: 'End of slide show', key: 'Left arrow', how: 'to go back', back: { type: 'prev' } }
};

/**
 * Across the top of the slide: the audience is not seeing it. It is always drawn, and faded by opacity, so that
 * it can leave as it came; while it is off its button is disabled, which keeps it out of the Tab cycle
 * (`useShowKeys`), and it keeps the words it last had for the length of the fade.
 */
function ScreenBanner({ screen, resume }: { screen: Screen; resume: (blank: Blank) => void }) {
  const [kept, setKept] = useState<Blank>('black');
  if (screen !== 'none' && screen !== kept) setKept(screen);
  const on = screen !== 'none';
  const b = BLANKS[kept];
  return (
    <>
      <div className="sp-banner" data-on={on} data-screen={kept} aria-hidden={!on}>
        <span className="sp-banner-swatch" aria-hidden="true" />
        <span className="sp-banner-text">
          <span className="sp-banner-title">{b.title}</span>
          <span className="sp-banner-how">
            Press <kbd>{b.key}</kbd> {b.how}.
          </span>
        </span>
        <button type="button" className="sp-banner-resume" disabled={!on} onClick={() => resume(kept)}>
          Resume
        </button>
      </div>
      <span className="sp-sr sp-banner-status" role="status">
        {on ? b.title : ''}
      </span>
    </>
  );
}

export function PresenterView({ ctx, from, close, launch, factory }: HostProps & { launch: Launch; factory?: ChannelFactory }) {
  const root = useRef<HTMLDivElement>(null);
  const handle = useRef<ShowHandle | null>(null);
  const model = ctx.model;
  const token = useMemo(() => launch.show ?? newShowToken(), [launch.show]);
  const channel = useMemo(() => ({ name: channelName(ctx.meta.id, token), factory }), [ctx.meta.id, token, factory]);
  const [audience, setAudience] = useState<Window | null>(launch.audience);
  const audienceRef = useRef(audience);
  audienceRef.current = audience;
  const [watch] = useState(() => new Stopwatch());
  const [notesSize, setNotesSize] = useNotesSize();

  const leave = useLeave(ctx, close, handle);
  const onExit = useCallback(() => {
    // The audience's window has been told; this is for one that did not hear.
    try {
      audienceRef.current?.close();
    } catch {
      // Already gone.
    }
    leave();
  }, [leave]);

  const fullscreen = useFullscreen(root, { start: false, onEscape: () => (handle.current ? handle.current.end() : onExit()) });
  const show = useShow({ model, from, role: 'presenter', channel, onExit, onFullscreen: fullscreen.toggle });
  handle.current = show;
  useShowKeys(root, show, { buttons: true });
  useEffect(() => root.current?.focus({ preventScroll: true }), []);

  // A window the browser closed leaves no message, so ask the handle now and then.
  const [audienceClosed, setAudienceClosed] = useState(false);
  useEffect(() => {
    if (!audience) {
      setAudienceClosed(false);
      return;
    }
    const check = () => setAudienceClosed(audience.closed);
    check();
    const t = setInterval(check, 1500);
    return () => clearInterval(t);
  }, [audience]);
  const open = !!show && show.peers > 0 && !audienceClosed;
  // Whether the window is full screen is the window's to say: an older one says nothing, and so does a closed one.
  const audienceFull = open ? (show?.peerFull ?? null) : null;
  // A window just opened has not said hello yet: that is opening, not closed.
  const audienceSaid = open
    ? `Audience window open${audienceFull === null ? '' : audienceFull ? ', full screen' : ', windowed'}`
    : audience && !audienceClosed && !show?.heard
      ? 'Audience window opening'
      : 'Audience window closed';

  /** A button pressed with the mouse gives the keyboard back to the show, so Space is Next again. */
  const pressed = useCallback(() => root.current?.focus({ preventScroll: true }), []);
  const run = (fn: () => void) => () => {
    fn();
    pressed();
  };
  const resume = (blank: Blank) => {
    show?.act(BLANKS[blank].back);
    pressed();
  };

  const openAudience = () => {
    const w = openAudienceWindow(audienceUrl(window.location, token, show?.index ?? from), token);
    setAudience(w);
    if (!w) ctx.notify({ text: POPUP_BLOCKED, tone: 'danger' });
    else w.focus?.();
  };

  const id = show?.state.slide ?? null;
  const slide = useSlide(model, id);
  const upNext = useDeckSlice(model, (m) => nextId(m, id), (c) => c.order || c.slides.size > 0, undefined, id);
  const next = useSlide(model, upNext);
  const lines = useMemo(() => noteLines(slide?.notes), [slide?.notes]);
  const [fitRef, fit] = useSize<HTMLDivElement>();
  const design = ctx.design;
  const nextHeight = (slideHeight(design.size) * fit.w) / 1920;

  return createPortal(
    <div ref={root} className="sp-console" data-app="slides" data-theme="dark" tabIndex={-1} role="dialog" aria-modal="true" aria-label="Presenter view">
      <header className="sp-bar">
        <Timer watch={watch} onPressed={pressed} />
        <span className="sp-where">{show ? `Slide ${show.index + 1} of ${show.count}` : ''}</span>
        <span className="sp-grow" />
        <Clock />
        {show?.heard || audience ? (
          <span className="sp-bar-group">
            <span className="sp-aud">
              <span className="sp-clock">{audienceSaid}</span>
              {audienceFull === false && <span className="sp-aud-hint">Click it and press F11 or F.</span>}
            </span>
            {!open && (
              <Button size="sm" variant="secondary" onClick={run(openAudience)}>
                Open audience window
              </Button>
            )}
          </span>
        ) : (
          <Button size="sm" variant="secondary" onClick={run(openAudience)}>
            Open audience window
          </Button>
        )}
        <Button size="sm" variant="primary" icon={xIcon} onClick={() => show?.end()}>
          End show
        </Button>
      </header>
      <div className="sp-body">
        <div className="sp-main">
          <div className="sp-cur">
            {show && <ScreenBanner screen={show.state.screen} resume={resume} />}
            {show && <Live model={model} design={design} show={show} mirror />}
          </div>
          <div className="sp-controls">
            <Button size="sm" icon={arrowLeftIcon} onClick={run(() => show?.act({ type: 'prev' }))}>
              Previous
            </Button>
            <Button size="sm" variant="primary" icon={arrowRightIcon} onClick={run(() => show?.act({ type: 'next' }))}>
              Next
            </Button>
            <Button size="sm" icon={eyeSlashIcon} aria-pressed={show?.state.screen === 'black'} onClick={run(() => show?.act({ type: 'screen', screen: 'black' }))}>
              Black screen
            </Button>
            <Button size="sm" icon={cursorIcon} aria-pressed={show?.state.laser === true} onClick={run(() => show?.act({ type: 'laser' }))}>
              Laser
            </Button>
          </div>
        </div>
        <aside className="sp-side">
          <section className="sp-card sp-next" aria-label="Next slide">
            <div className="sp-card-head">
              <h2>Next</h2>
            </div>
            <div ref={fitRef} className="sp-next-fit">
              <div className="sp-next-box" style={{ height: nextHeight || undefined }}>
                {next && upNext && fit.w > 0 ? (
                  <SlideView design={design} slide={next} width={fit.w} number={model.indexOf(upNext) + 1} mode="thumb" />
                ) : (
                  !upNext && <div className="sp-next-end">End of slide show</div>
                )}
              </div>
            </div>
          </section>
          <section className="sp-card sp-notes" aria-label="Speaker notes">
            <div className="sp-card-head">
              <h2>Notes</h2>
              <IconButton icon={minusIcon} label="Smaller text" size="sm" disabled={notesSize <= NOTES_SIZE.min} onClick={run(() => setNotesSize(notesSize - NOTES_SIZE.step))} />
              <span className="sp-size" aria-hidden="true">
                {notesSize}
              </span>
              <IconButton icon={plusIcon} label="Larger text" size="sm" disabled={notesSize >= NOTES_SIZE.max} onClick={run(() => setNotesSize(notesSize + NOTES_SIZE.step))} />
            </div>
            <div className="sp-notes-body" style={{ fontSize: notesSize }} aria-label="Notes for this slide">
              {lines.length ? (
                lines.map((l, i) => (
                  <p key={i} style={{ paddingLeft: `${l.level * 1.2}em` }}>
                    {l.bullet && <span className="sp-bullet">{l.bullet}</span>}
                    <span className="sp-line">
                      {l.runs.length
                        ? l.runs.map((r, j) => (
                            <span
                              key={j}
                              style={{
                                fontWeight: r.bold ? 700 : undefined,
                                fontStyle: r.italic ? 'italic' : undefined,
                                textDecoration: [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ') || undefined
                              }}
                            >
                              {r.text}
                            </span>
                          ))
                        : ' '}
                    </span>
                  </p>
                ))
              ) : (
                <p className="sp-notes-empty">No notes for this slide.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>,
    document.body
  );
}
