/**
 * Thickness multiplier model for trace widths.
 *
 * The multiplier is always relative to a board-level default trace width.
 * A multiplier of 1.0 means "use the board default", 2.0 means "double width",
 * 0.5 means "half width", etc.
 */

/** Named semantic thickness levels, mapped to their multiplier values. */
export const TraceThickness = {
  Hairline: 0.5,
  Thin: 0.75,
  Default: 1.0,
  Medium: 1.5,
  Thick: 2.0,
  Power: 3.0,
} as const;

export type TraceThicknessName = keyof typeof TraceThickness;
export type TraceThicknessMultiplier = (typeof TraceThickness)[TraceThicknessName];

/**
 * Convert a thickness multiplier to an absolute width in mm.
 *
 * @param multiplier  - Thickness multiplier (e.g. 1.0 for default).
 * @param defaultWidth - Board-level default trace width in mm.
 * @returns Absolute trace width in mm.
 */
export function multiplierToWidth(
  multiplier: number,
  defaultWidth: number,
): number {
  return multiplier * defaultWidth;
}

/**
 * Convert an absolute trace width to a thickness multiplier.
 *
 * @param width        - Absolute trace width in mm.
 * @param defaultWidth - Board-level default trace width in mm.
 * @returns Thickness multiplier relative to the default width.
 */
export function widthToMultiplier(
  width: number,
  defaultWidth: number,
): number {
  if (defaultWidth === 0) {
    throw new RangeError("defaultWidth must be non-zero");
  }
  return width / defaultWidth;
}
