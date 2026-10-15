/** The widest a slide can be drawn in a box without being cut, in CSS px. */
export function fitWidth(boxWidth: number, boxHeight: number, slideWidth: number, slideHeight: number): number {
  if (!(boxWidth > 0) || !(boxHeight > 0) || !(slideWidth > 0) || !(slideHeight > 0)) return 0;
  return Math.floor(Math.min(boxWidth, (boxHeight * slideWidth) / slideHeight));
}
