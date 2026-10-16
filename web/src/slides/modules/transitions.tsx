/**
 * The Transitions tab: Preview, the gallery of the five kinds with Effect options, and Timing (the
 * duration and Apply to all slides). The preview is drawn over the slide on the canvas.
 *
 * What a button does is in `present/transitionEdit.ts`, one function each with a test; what the
 * show does with a transition is in `present/transitions.ts` and `present/Stage.tsx`. A control that
 * is off for a reader is off by `can.edit`, never by a role.
 */

import { filesIcon } from '../../core/icons';
import type { Command, MenuEntry } from '../../core/shell/types';
import { arrowsOutCardinalIcon } from '../present/icons';
import { TransitionPreviewLayer } from '../present/PreviewLayer';
import { requestPreview } from '../present/previewBus';
import { DurationField, TransitionGallery } from '../present/TransitionGallery';
import { applyToAll, currentTransition, markedSide, setKind, setSide, type TransitionTarget } from '../present/transitionEdit';
import { kindOf, SIDE_LABELS, SIDES, TRANSITION_KINDS, TRANSITION_LABELS, usesDirection } from '../present/transitions';
import { playIcon } from './icons';
import type { SlidesContext, SlidesModule } from './types';

const target = (c: SlidesContext): TransitionTarget => ({ model: c.model, selection: c.selection });
const cannotEdit = (c: SlidesContext): boolean => !c.can.edit || !c.slideId;
const kindHere = (c: SlidesContext) => kindOf(currentTransition(target(c)));

const sides: MenuEntry<SlidesContext>[] = SIDES.map((side) => ({
  label: SIDE_LABELS[side],
  active: (c) => markedSide(currentTransition(target(c))) === side,
  disabled: (c) => cannotEdit(c) || !usesDirection(kindHere(c)),
  run: (c) => {
    if (setSide(target(c), side)) requestPreview();
  }
}));

const commands: Command<SlidesContext>[] = [
  ...TRANSITION_KINDS.map(
    (kind): Command<SlidesContext> => ({
      id: `transition.${kind}`,
      title: `Transition: ${TRANSITION_LABELS[kind]}`,
      section: 'Slide',
      icon: playIcon,
      keywords: ['transitions', 'animation', 'slide change'],
      visible: (c) => c.can.edit && !!c.slideId,
      run: (c) => {
        if (setKind(target(c), kind) && kind !== 'none') requestPreview();
      }
    })
  ),
  {
    id: 'transition.apply-all',
    title: 'Apply transition to all slides',
    section: 'Slide',
    icon: filesIcon,
    keywords: ['transitions', 'every slide'],
    visible: (c) => c.can.edit && !!c.slideId,
    run: (c) => void applyToAll(target(c))
  },
  {
    id: 'transition.preview',
    title: 'Preview transition',
    section: 'Slide',
    icon: playIcon,
    keywords: ['transitions', 'play'],
    visible: (c) => !!c.slideId,
    disabled: (c) => kindHere(c) === 'none',
    run: () => requestPreview()
  }
];

export const transitionsModule: SlidesModule = {
  id: 'transitions',
  ribbon: [
    {
      id: 'transitions.preview',
      tab: 'transitions',
      order: 100,
      label: 'Preview',
      items: [
        {
          type: 'button',
          id: 'transitions.preview-button',
          label: 'Preview',
          icon: playIcon,
          showLabel: true,
          disabled: (c) => !c.slideId || kindHere(c) === 'none',
          run: () => requestPreview()
        }
      ]
    },
    {
      id: 'transitions.transition',
      tab: 'transitions',
      order: 200,
      label: 'Transition to this slide',
      items: [
        { type: 'custom', id: 'transitions.gallery', render: (c) => <TransitionGallery ctx={c} /> },
        { type: 'menu', id: 'transitions.options', label: 'Effect options', icon: arrowsOutCardinalIcon, showLabel: true, disabled: (c) => cannotEdit(c) || !usesDirection(kindHere(c)), entries: sides }
      ]
    },
    {
      id: 'transitions.timing',
      tab: 'transitions',
      order: 300,
      label: 'Timing',
      items: [
        { type: 'custom', id: 'transitions.duration', render: (c) => <DurationField ctx={c} /> },
        { type: 'button', id: 'transitions.apply-all', label: 'Apply to all slides', icon: filesIcon, showLabel: true, disabled: cannotEdit, run: (c) => void applyToAll(target(c)) }
      ]
    }
  ],
  commands,
  canvas: [{ id: 'transition-preview', render: (c, frame) => <TransitionPreviewLayer ctx={c} frame={frame} /> }]
};
