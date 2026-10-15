/**
 * Icons: Phosphor, regular weight, as the approved design draws them.
 *
 * Each icon is its own `?raw` import of the SVG in `@phosphor-icons/core` (a dev
 * dependency: the markup is inlined at build time, nothing is fetched or shipped
 * that is not used). A module that needs an icon this file does not export
 * imports it the same way in its own file, so nobody edits a shared list:
 *
 *     import boldRaw from '@phosphor-icons/core/assets/regular/text-b.svg?raw';
 *     const bold = ph(boldRaw);
 *     <Icon icon={bold} size={16} />
 *
 * `ph()` is marked pure, so an icon nobody imports is dropped from the bundle.
 * Home's chunk therefore carries only the dozen or so icons Home draws.
 *
 * The weight is regular and the size 16 to 18, with 20 on the rail (README, "Type
 * and icons"). Colour is `currentColor`.
 */

import type React from 'react';
import houseRaw from '@phosphor-icons/core/assets/regular/house.svg?raw';
import usersRaw from '@phosphor-icons/core/assets/regular/users.svg?raw';
import starRaw from '@phosphor-icons/core/assets/regular/star.svg?raw';
import cardsRaw from '@phosphor-icons/core/assets/regular/cards.svg?raw';
import trashRaw from '@phosphor-icons/core/assets/regular/trash.svg?raw';
import gearRaw from '@phosphor-icons/core/assets/regular/gear.svg?raw';
import magnifyingGlassRaw from '@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw';
import uploadSimpleRaw from '@phosphor-icons/core/assets/regular/upload-simple.svg?raw';
import plusRaw from '@phosphor-icons/core/assets/regular/plus.svg?raw';
import fileTextRaw from '@phosphor-icons/core/assets/regular/file-text.svg?raw';
import tableRaw from '@phosphor-icons/core/assets/regular/table.svg?raw';
import presentationChartRaw from '@phosphor-icons/core/assets/regular/presentation-chart.svg?raw';
import lockSimpleRaw from '@phosphor-icons/core/assets/regular/lock-simple.svg?raw';
import lockKeyRaw from '@phosphor-icons/core/assets/regular/lock-key.svg?raw';
import buildingsRaw from '@phosphor-icons/core/assets/regular/buildings.svg?raw';
import rowsRaw from '@phosphor-icons/core/assets/regular/rows.svg?raw';
import squaresFourRaw from '@phosphor-icons/core/assets/regular/squares-four.svg?raw';
import caretDownRaw from '@phosphor-icons/core/assets/regular/caret-down.svg?raw';
import caretUpRaw from '@phosphor-icons/core/assets/regular/caret-up.svg?raw';
import caretLeftRaw from '@phosphor-icons/core/assets/regular/caret-left.svg?raw';
import caretRightRaw from '@phosphor-icons/core/assets/regular/caret-right.svg?raw';
import xRaw from '@phosphor-icons/core/assets/regular/x.svg?raw';
import filesRaw from '@phosphor-icons/core/assets/regular/files.svg?raw';
import arrowUUpLeftRaw from '@phosphor-icons/core/assets/regular/arrow-u-up-left.svg?raw';
import arrowUUpRightRaw from '@phosphor-icons/core/assets/regular/arrow-u-up-right.svg?raw';
import clipboardTextRaw from '@phosphor-icons/core/assets/regular/clipboard-text.svg?raw';
import paintBrushRaw from '@phosphor-icons/core/assets/regular/paint-brush.svg?raw';
import textBRaw from '@phosphor-icons/core/assets/regular/text-b.svg?raw';
import textItalicRaw from '@phosphor-icons/core/assets/regular/text-italic.svg?raw';
import textUnderlineRaw from '@phosphor-icons/core/assets/regular/text-underline.svg?raw';
import textStrikethroughRaw from '@phosphor-icons/core/assets/regular/text-strikethrough.svg?raw';
import highlighterCircleRaw from '@phosphor-icons/core/assets/regular/highlighter-circle.svg?raw';
import listBulletsRaw from '@phosphor-icons/core/assets/regular/list-bullets.svg?raw';
import listNumbersRaw from '@phosphor-icons/core/assets/regular/list-numbers.svg?raw';
import textIndentRaw from '@phosphor-icons/core/assets/regular/text-indent.svg?raw';
import textOutdentRaw from '@phosphor-icons/core/assets/regular/text-outdent.svg?raw';
import textAlignLeftRaw from '@phosphor-icons/core/assets/regular/text-align-left.svg?raw';
import microphoneRaw from '@phosphor-icons/core/assets/regular/microphone.svg?raw';
import chatCircleTextRaw from '@phosphor-icons/core/assets/regular/chat-circle-text.svg?raw';
import clockCounterClockwiseRaw from '@phosphor-icons/core/assets/regular/clock-counter-clockwise.svg?raw';
import minusRaw from '@phosphor-icons/core/assets/regular/minus.svg?raw';
import bookOpenRaw from '@phosphor-icons/core/assets/regular/book-open.svg?raw';
import globeSimpleRaw from '@phosphor-icons/core/assets/regular/globe-simple.svg?raw';
import checkRaw from '@phosphor-icons/core/assets/regular/check.svg?raw';
import checkCircleRaw from '@phosphor-icons/core/assets/regular/check-circle.svg?raw';
import dotsThreeRaw from '@phosphor-icons/core/assets/regular/dots-three.svg?raw';
import pencilSimpleRaw from '@phosphor-icons/core/assets/regular/pencil-simple.svg?raw';
import linkRaw from '@phosphor-icons/core/assets/regular/link.svg?raw';
import linkBreakRaw from '@phosphor-icons/core/assets/regular/link-break.svg?raw';
import quotesRaw from '@phosphor-icons/core/assets/regular/quotes.svg?raw';
import codeRaw from '@phosphor-icons/core/assets/regular/code.svg?raw';
import codeBlockRaw from '@phosphor-icons/core/assets/regular/code-block.svg?raw';
import userPlusRaw from '@phosphor-icons/core/assets/regular/user-plus.svg?raw';
import calendarBlankRaw from '@phosphor-icons/core/assets/regular/calendar-blank.svg?raw';
import envelopeSimpleRaw from '@phosphor-icons/core/assets/regular/envelope-simple.svg?raw';
import eyeRaw from '@phosphor-icons/core/assets/regular/eye.svg?raw';
import eyeSlashRaw from '@phosphor-icons/core/assets/regular/eye-slash.svg?raw';
import shieldCheckRaw from '@phosphor-icons/core/assets/regular/shield-check.svg?raw';
import warningCircleRaw from '@phosphor-icons/core/assets/regular/warning-circle.svg?raw';
import copyRaw from '@phosphor-icons/core/assets/regular/copy.svg?raw';
import userCircleRaw from '@phosphor-icons/core/assets/regular/user-circle.svg?raw';
import sparkleRaw from '@phosphor-icons/core/assets/regular/sparkle.svg?raw';
import arrowSquareOutRaw from '@phosphor-icons/core/assets/regular/arrow-square-out.svg?raw';
import folderOpenRaw from '@phosphor-icons/core/assets/regular/folder-open.svg?raw';
import filePlusRaw from '@phosphor-icons/core/assets/regular/file-plus.svg?raw';
import downloadSimpleRaw from '@phosphor-icons/core/assets/regular/download-simple.svg?raw';
import printerRaw from '@phosphor-icons/core/assets/regular/printer.svg?raw';
import infoRaw from '@phosphor-icons/core/assets/regular/info.svg?raw';
import wifiSlashRaw from '@phosphor-icons/core/assets/regular/wifi-slash.svg?raw';
import spinnerGapRaw from '@phosphor-icons/core/assets/regular/spinner-gap.svg?raw';
import arrowCounterClockwiseRaw from '@phosphor-icons/core/assets/regular/arrow-counter-clockwise.svg?raw';
import sidebarSimpleRaw from '@phosphor-icons/core/assets/regular/sidebar-simple.svg?raw';
import notePencilRaw from '@phosphor-icons/core/assets/regular/note-pencil.svg?raw';
import arrowRightRaw from '@phosphor-icons/core/assets/regular/arrow-right.svg?raw';
import arrowLeftRaw from '@phosphor-icons/core/assets/regular/arrow-left.svg?raw';
import listRaw from '@phosphor-icons/core/assets/regular/list.svg?raw';
import dotsThreeVerticalRaw from '@phosphor-icons/core/assets/regular/dots-three-vertical.svg?raw';
import eraserRaw from '@phosphor-icons/core/assets/regular/eraser.svg?raw';
import keyboardRaw from '@phosphor-icons/core/assets/regular/keyboard.svg?raw';
import textSubscriptRaw from '@phosphor-icons/core/assets/regular/text-subscript.svg?raw';
import textSuperscriptRaw from '@phosphor-icons/core/assets/regular/text-superscript.svg?raw';
import textAaRaw from '@phosphor-icons/core/assets/regular/text-aa.svg?raw';
import paintBucketRaw from '@phosphor-icons/core/assets/regular/paint-bucket.svg?raw';
import starFillRaw from '@phosphor-icons/core/assets/fill/star-fill.svg?raw';
import checkCircleFillRaw from '@phosphor-icons/core/assets/fill/check-circle-fill.svg?raw';

/** The markup inside a Phosphor SVG's outer element. */
export type PhIcon = string;

/** Take the shapes out of an SVG file's text. The viewBox is always 256. */
export function ph(raw: string): PhIcon {
  const start = raw.indexOf('>') + 1;
  const end = raw.lastIndexOf('</svg>');
  return raw.slice(start, end);
}

export function Icon({
  icon,
  size = 16,
  className,
  style,
  label
}: {
  icon: PhIcon;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Names the icon for assistive technology. Without it the icon is decoration. */
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="currentColor"
      focusable="false"
      className={className ? `oa-ico ${className}` : 'oa-ico'}
      style={style}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      dangerouslySetInnerHTML={{ __html: icon }}
    />
  );
}


export const houseIcon = /* @__PURE__ */ ph(houseRaw);
export const usersIcon = /* @__PURE__ */ ph(usersRaw);
export const starIcon = /* @__PURE__ */ ph(starRaw);
export const cardsIcon = /* @__PURE__ */ ph(cardsRaw);
export const trashIcon = /* @__PURE__ */ ph(trashRaw);
export const gearIcon = /* @__PURE__ */ ph(gearRaw);
export const magnifyingGlassIcon = /* @__PURE__ */ ph(magnifyingGlassRaw);
export const uploadSimpleIcon = /* @__PURE__ */ ph(uploadSimpleRaw);
export const plusIcon = /* @__PURE__ */ ph(plusRaw);
export const fileTextIcon = /* @__PURE__ */ ph(fileTextRaw);
export const tableIcon = /* @__PURE__ */ ph(tableRaw);
export const presentationChartIcon = /* @__PURE__ */ ph(presentationChartRaw);
export const lockSimpleIcon = /* @__PURE__ */ ph(lockSimpleRaw);
export const lockKeyIcon = /* @__PURE__ */ ph(lockKeyRaw);
export const buildingsIcon = /* @__PURE__ */ ph(buildingsRaw);
export const rowsIcon = /* @__PURE__ */ ph(rowsRaw);
export const squaresFourIcon = /* @__PURE__ */ ph(squaresFourRaw);
export const caretDownIcon = /* @__PURE__ */ ph(caretDownRaw);
export const caretUpIcon = /* @__PURE__ */ ph(caretUpRaw);
export const caretLeftIcon = /* @__PURE__ */ ph(caretLeftRaw);
export const caretRightIcon = /* @__PURE__ */ ph(caretRightRaw);
export const xIcon = /* @__PURE__ */ ph(xRaw);
export const filesIcon = /* @__PURE__ */ ph(filesRaw);
export const arrowUUpLeftIcon = /* @__PURE__ */ ph(arrowUUpLeftRaw);
export const arrowUUpRightIcon = /* @__PURE__ */ ph(arrowUUpRightRaw);
export const clipboardTextIcon = /* @__PURE__ */ ph(clipboardTextRaw);
export const paintBrushIcon = /* @__PURE__ */ ph(paintBrushRaw);
export const textBIcon = /* @__PURE__ */ ph(textBRaw);
export const textItalicIcon = /* @__PURE__ */ ph(textItalicRaw);
export const textUnderlineIcon = /* @__PURE__ */ ph(textUnderlineRaw);
export const textStrikethroughIcon = /* @__PURE__ */ ph(textStrikethroughRaw);
export const highlighterCircleIcon = /* @__PURE__ */ ph(highlighterCircleRaw);
export const listBulletsIcon = /* @__PURE__ */ ph(listBulletsRaw);
export const listNumbersIcon = /* @__PURE__ */ ph(listNumbersRaw);
export const textIndentIcon = /* @__PURE__ */ ph(textIndentRaw);
export const textOutdentIcon = /* @__PURE__ */ ph(textOutdentRaw);
export const textAlignLeftIcon = /* @__PURE__ */ ph(textAlignLeftRaw);
export const microphoneIcon = /* @__PURE__ */ ph(microphoneRaw);
export const chatCircleTextIcon = /* @__PURE__ */ ph(chatCircleTextRaw);
export const clockCounterClockwiseIcon = /* @__PURE__ */ ph(clockCounterClockwiseRaw);
export const minusIcon = /* @__PURE__ */ ph(minusRaw);
export const bookOpenIcon = /* @__PURE__ */ ph(bookOpenRaw);
export const globeSimpleIcon = /* @__PURE__ */ ph(globeSimpleRaw);
export const checkIcon = /* @__PURE__ */ ph(checkRaw);
export const checkCircleIcon = /* @__PURE__ */ ph(checkCircleRaw);
export const dotsThreeIcon = /* @__PURE__ */ ph(dotsThreeRaw);
export const pencilSimpleIcon = /* @__PURE__ */ ph(pencilSimpleRaw);
export const linkIcon = /* @__PURE__ */ ph(linkRaw);
export const linkBreakIcon = /* @__PURE__ */ ph(linkBreakRaw);
export const quotesIcon = /* @__PURE__ */ ph(quotesRaw);
export const codeIcon = /* @__PURE__ */ ph(codeRaw);
export const codeBlockIcon = /* @__PURE__ */ ph(codeBlockRaw);
export const userPlusIcon = /* @__PURE__ */ ph(userPlusRaw);
export const calendarBlankIcon = /* @__PURE__ */ ph(calendarBlankRaw);
export const envelopeSimpleIcon = /* @__PURE__ */ ph(envelopeSimpleRaw);
export const eyeIcon = /* @__PURE__ */ ph(eyeRaw);
export const eyeSlashIcon = /* @__PURE__ */ ph(eyeSlashRaw);
export const shieldCheckIcon = /* @__PURE__ */ ph(shieldCheckRaw);
export const warningCircleIcon = /* @__PURE__ */ ph(warningCircleRaw);
export const copyIcon = /* @__PURE__ */ ph(copyRaw);
export const userCircleIcon = /* @__PURE__ */ ph(userCircleRaw);
export const sparkleIcon = /* @__PURE__ */ ph(sparkleRaw);
export const arrowSquareOutIcon = /* @__PURE__ */ ph(arrowSquareOutRaw);
export const folderOpenIcon = /* @__PURE__ */ ph(folderOpenRaw);
export const filePlusIcon = /* @__PURE__ */ ph(filePlusRaw);
export const downloadSimpleIcon = /* @__PURE__ */ ph(downloadSimpleRaw);
export const printerIcon = /* @__PURE__ */ ph(printerRaw);
export const infoIcon = /* @__PURE__ */ ph(infoRaw);
export const wifiSlashIcon = /* @__PURE__ */ ph(wifiSlashRaw);
export const spinnerGapIcon = /* @__PURE__ */ ph(spinnerGapRaw);
export const arrowCounterClockwiseIcon = /* @__PURE__ */ ph(arrowCounterClockwiseRaw);
export const sidebarSimpleIcon = /* @__PURE__ */ ph(sidebarSimpleRaw);
export const notePencilIcon = /* @__PURE__ */ ph(notePencilRaw);
export const arrowRightIcon = /* @__PURE__ */ ph(arrowRightRaw);
export const arrowLeftIcon = /* @__PURE__ */ ph(arrowLeftRaw);
export const listIcon = /* @__PURE__ */ ph(listRaw);
export const dotsThreeVerticalIcon = /* @__PURE__ */ ph(dotsThreeVerticalRaw);
export const eraserIcon = /* @__PURE__ */ ph(eraserRaw);
export const keyboardIcon = /* @__PURE__ */ ph(keyboardRaw);
export const textSubscriptIcon = /* @__PURE__ */ ph(textSubscriptRaw);
export const textSuperscriptIcon = /* @__PURE__ */ ph(textSuperscriptRaw);
export const textAaIcon = /* @__PURE__ */ ph(textAaRaw);
export const paintBucketIcon = /* @__PURE__ */ ph(paintBucketRaw);
export const starFillIcon = /* @__PURE__ */ ph(starFillRaw);
export const checkCircleFillIcon = /* @__PURE__ */ ph(checkCircleFillRaw);
