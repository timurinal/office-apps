/**
 * The small star under a slide's number in the rail and the sorter when the slide has a transition.
 * Pressing it plays the transition, as the Transitions tab's Preview does.
 *
 * It is a button inside a slide's own option, so the press is made not to be a press on the slide: the
 * rail and the sorter leave a pointer that goes down on it alone (`data-preview`), and the mouse down
 * takes no focus, so a caret in the slide stays. It is not a tab stop, since a deck can carry a
 * hundred; the ribbon's Preview is the keyboard's way to the same thing.
 */

import { Icon, sparkleIcon } from '../../core/icons';
import type { Transition } from '../model/deck';
import { kindOf, TRANSITION_LABELS } from './transitions';
import './present.css';

/** Whether a press began on a marker, which the list it is in does not take for a press on the slide. */
export const onMarker = (target: EventTarget | null): boolean => target instanceof Element && target.closest('[data-preview]') !== null;

export function TransitionMarker({ transition, onPreview }: { transition: Transition | undefined; onPreview: () => void }) {
  const kind = kindOf(transition);
  if (kind === 'none') return null;
  const label = `Preview transition: ${TRANSITION_LABELS[kind]}`;
  return (
    <button type="button" className="sp-mark" data-preview title={label} aria-label={label} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={onPreview}>
      <Icon icon={sparkleIcon} size={12} />
    </button>
  );
}
