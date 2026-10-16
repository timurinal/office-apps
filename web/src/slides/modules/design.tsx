/**
 * The Design module: how the whole presentation looks.
 *
 *   Design › Themes      the theme gallery: each of `THEMES` drawn as its ground, its type and its six
 *                        accents; choosing one is one step that writes the theme, its master and its
 *                        layouts, and every slide keeps its layout and its text while its
 *                        placeholders move to where the new layout puts them
 *   Design › Customise   Layout ▾ (the same gallery as Home's), and Background ▾: a solid colour from
 *                        the theme, a gradient, a picture, or the layout's own again, for the slides
 *                        chosen in the rail or for all of them
 *
 * There is no slide size here. A deck's size is its aspect (16:9, 4:3, 16:10) and every layout is
 * drawn for 16:9: changing the aspect would need every layout drawn again, and the model has no step
 * for it, so the Design tab leaves it out rather than offer a button that moves things off the slide.
 *
 * A control that changes the deck is off for a reader by `can.edit`.
 */

import { useState } from 'react';
import { caretDownIcon, Icon } from '../../core/icons';
import type { Command, RibbonGroup } from '../../core/shell/types';
import { Popover } from '../../core/ui';
import { chosenLayout, setLayout, type Target } from '../editor/actions';
import { LayoutButton } from '../editor/LayoutGallery';
import type { Fill, ThemeJSON } from '../model/deck';
import type { SlideModel } from '../model/model';
import { gradientCss, fontStack } from '../render/paint';
import { THEME_PREVIEWS, layoutsFor, masterFor, themeById, type ThemePreview } from '../themes';
import { ColorPanel } from '../panes/format/ColorPicker';
import { backgroundTargets, GRADIENTS, readBackground, setBackground } from '../panes/format/background';
import { Check } from '../panes/format/fields';
import { layoutIcon } from './icons';
import { paletteIcon } from './insert/icons';
import { keepSelection, useOpen } from './insert/menus';
import { pictureProblem, pickPictureFiles, storePicture } from './insert/picture';
import type { SlidesContext, SlidesModule } from './types';
import '../panes/format/design.css';

const target = (c: SlidesContext): Target => ({ model: c.model, selection: c.selection });

/** A theme for the whole presentation: its theme, master and layouts together, as one step. False when it is the one already. */
export function applyTheme(model: SlideModel, id: string): boolean {
  const theme: ThemeJSON | undefined = themeById(id);
  if (!theme || model.design().theme.id === id) return false;
  return model.setDesign({ theme, master: masterFor(theme), layouts: layoutsFor(theme) });
}

// ── the theme gallery ───────────────────────────────────────────────────────

function ThemeTile({ p, active, disabled, onPick, fonts, rb }: { p: ThemePreview; active: boolean; disabled: boolean; onPick: () => void; fonts?: boolean; rb?: boolean }) {
  return (
    <button
      type="button"
      {...(rb ? { 'data-rb-item': true, 'data-id': `design.theme.${p.id}` } : {})}
      className="sl-theme"
      title={`${p.name}, ${p.major} and ${p.minor}`}
      aria-label={`${p.name} theme`}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={keepSelection}
      onClick={onPick}
    >
      <span className="sl-theme-card" style={{ background: p.ground, color: p.ink }}>
        <span className="sl-theme-band" style={{ background: p.hero }} />
        <span className="sl-theme-aa" style={{ fontFamily: fontStack(p.major) }}>
          Aa
        </span>
        <span className="sl-theme-dots">
          {p.accents.map((a, i) => (
            <span key={i} style={{ background: a }} />
          ))}
        </span>
      </span>
      <span className="sl-theme-name">{p.name}</span>
      {fonts && <span className="sl-theme-fonts">{p.major === p.minor ? p.major : `${p.major}, ${p.minor}`}</span>}
    </button>
  );
}

/** The first themes in a row, and the whole gallery under an arrow. */
function ThemeGallery({ ctx }: { ctx: SlidesContext }) {
  const o = useOpen(360);
  const disabled = !ctx.can.edit;
  const current = ctx.design.theme.id;
  const pick = (id: string) => {
    o.close();
    applyTheme(ctx.model, id);
    ctx.actions.focusCanvas();
  };
  return (
    <span className="sl-themes" role="group" aria-label="Themes">
      {THEME_PREVIEWS.slice(0, 4).map((p) => (
        <ThemeTile key={p.id} p={p} rb active={p.id === current} disabled={disabled} onPick={() => pick(p.id)} />
      ))}
      <span className="oa-pop-wrap">
        <button
          type="button"
          data-rb-item
          data-id="design.themes.more"
          className="oa-rb-tb sl-themes-more"
          aria-label="All themes"
          title="All themes"
          aria-haspopup="dialog"
          aria-expanded={o.open}
          onMouseDown={keepSelection}
          onClick={o.toggle}
        >
          <Icon icon={caretDownIcon} size={11} />
        </button>
        <Popover open={o.open} onClose={o.close} align={o.align} role="dialog" label="Themes" className="sl-theme-pop">
          <div className="sl-theme-grid">
            {THEME_PREVIEWS.map((p) => (
              <ThemeTile key={p.id} p={p} fonts active={p.id === current} disabled={disabled} onPick={() => pick(p.id)} />
            ))}
          </div>
        </Popover>
      </span>
    </span>
  );
}

// ── the background menu ─────────────────────────────────────────────────────

function BackgroundButton({ ctx }: { ctx: SlidesContext }) {
  const o = useOpen(280);
  const [all, setAll] = useState(false);
  const theme = ctx.design.theme;
  const disabled = !ctx.can.edit || !ctx.slideId;
  const here = readBackground(ctx.model, backgroundTargets(target(ctx), all))?.value ?? null;

  const apply = (bg: Fill | null) => {
    o.close();
    setBackground(target(ctx), bg, all);
    ctx.actions.focusCanvas();
  };
  const picture = () => {
    o.close();
    pickPictureFiles(
      (files) =>
        void storePicture(ctx.meta.id, files[0]!).then(
          (stored) => setBackground(target(ctx), { kind: 'image', asset: { id: stored.asset.id }, fit: 'cover' }, all),
          (err: unknown) => ctx.notify(pictureProblem(err, files[0]!.name))
        ),
      false
    );
  };

  return (
    <span className="oa-pop-wrap">
      <button type="button" data-rb-item data-id="design.background" className="oa-rb-tl" aria-haspopup="dialog" aria-expanded={o.open} disabled={disabled} onMouseDown={keepSelection} onClick={o.toggle}>
        <Icon icon={paletteIcon} size={16} />
        Background
        <Icon icon={caretDownIcon} size={11} className="oa-rb-cv" />
      </button>
      <Popover open={o.open} onClose={o.close} align={o.align} role="dialog" label="Background" className="sl-bg-pop">
        <ColorPanel value={here?.kind === 'solid' ? here.color : null} theme={theme} onPick={(c) => apply({ kind: 'solid', color: c })} />
        <div className="sl-bg-section">
          <span className="sl-cp-title">Gradient</span>
          <div className="sl-bg-gradients" role="group" aria-label="Gradients">
            {GRADIENTS.map((g) => (
              <button
                key={g.id}
                type="button"
                className="sl-bg-gradient"
                title={g.label}
                aria-label={g.label}
                aria-pressed={here?.kind === 'gradient' && JSON.stringify(here) === JSON.stringify(g.fill)}
                style={{ background: gradientCss(g.fill, theme) ?? undefined }}
                onClick={() => apply(g.fill)}
              />
            ))}
          </div>
        </div>
        {ctx.source.kind === 'cloud' && (
          <button type="button" className="oa-menu-item" onClick={picture}>
            <span className="oa-menu-label">Picture…</span>
          </button>
        )}
        <button type="button" className="oa-menu-item" disabled={here === null} onClick={() => apply(null)}>
          <span className="oa-menu-label">Reset background</span>
        </button>
        <Check label="Apply to all slides" value={all} onChange={setAll} />
      </Popover>
    </span>
  );
}

const ribbon: RibbonGroup<SlidesContext>[] = [
  {
    id: 'design.themes',
    tab: 'design',
    order: 100,
    label: 'Themes',
    items: [{ type: 'custom', id: 'design.themes', render: (c) => <ThemeGallery ctx={c} /> }]
  },
  {
    id: 'design.customise',
    tab: 'design',
    order: 300,
    label: 'Customise',
    items: [
      {
        type: 'custom',
        id: 'design.layout',
        render: (c) => (
          <LayoutButton
            id="design.layout"
            label="Layout"
            icon={layoutIcon}
            disabled={!c.can.edit || !c.slideId}
            design={() => c.model.design()}
            current={() => chosenLayout(target(c))}
            onPick={(layout) => {
              setLayout(target(c), layout);
              c.actions.focusCanvas();
            }}
          />
        )
      },
      { type: 'custom', id: 'design.background', render: (c) => <BackgroundButton ctx={c} /> }
    ]
  }
];

const commands: Command<SlidesContext>[] = [
  ...THEME_PREVIEWS.map(
    (p): Command<SlidesContext> => ({
      id: `design.theme.${p.id}`,
      title: `Theme: ${p.name}`,
      section: 'Slide',
      icon: paletteIcon,
      keywords: ['design', 'colours', 'fonts', 'look'],
      visible: (c) => c.can.edit,
      disabled: (c) => c.design.theme.id === p.id,
      run: (c) => void applyTheme(c.model, p.id)
    })
  ),
  {
    id: 'design.background-reset',
    title: 'Reset background',
    section: 'Slide',
    icon: paletteIcon,
    keywords: ['design', 'background', 'colour'],
    visible: (c) => c.can.edit && !!c.slideId,
    run: (c) => void setBackground(target(c), null, false)
  }
];

export const designModule: SlidesModule = { id: 'design', ribbon, commands };
