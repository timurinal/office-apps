/**
 * What a predefined Slides template is.
 *
 * Where a Docs template carries its body, a Slides one carries a function that builds the whole
 * deck, so a card on Home costs a title and a description until it is pressed, and each press gets
 * a value of its own to turn into a document.
 */

import type { DeckJSON } from '../model/deck';

export interface SlidesTemplate {
  /** The part after `predefined:`. A card's id is built from it, so it does not change. */
  slug: string;
  /** The card's title. The new presentation's is the same. */
  title: string;
  /** One line, for the card's tooltip. */
  description: string;
  /** The slide the card draws, counting from 0. The first when it is left out. */
  cover?: number;
  /** A new deck each call. Deterministic: two calls give the same JSON. */
  deck(): DeckJSON;
}
