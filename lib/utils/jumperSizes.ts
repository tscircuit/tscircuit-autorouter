export type JumperFootprint = "0603" | "1206" | "1206x4_pair";

// NOTE: 0805 should be avoided as a jumper because it has a bad ratio of pad
// size to under-body clearance

/**
 * 0603 footprint dimensions in mm
 * 0.8mm x 0.95mm pads, 1.65mm center-to-center
 */
export const JUMPER_0603 = {
  length: 1.65,
  width: 0.95,
  padLength: 0.8,
  padWidth: 0.95,
};

/**
 * 1206 footprint dimensions in mm
 * Actual 1206: 3.2mm x 1.6mm
 */
export const JUMPER_1206 = {
  length: 3.2,
  width: 1.6,
  padLength: 0.6,
  padWidth: 1.6,
};

/**
 * 1206x4 resistor array - dimensions for a single internal jumper pair
 * Each pair has pads at X = -1.35mm and X = 1.35mm (2.7mm apart)
 * Pad dimensions: 0.8mm (X) x 0.5mm (Y)
 */
export const JUMPER_1206X4_PAIR = {
  length: 2.7, // center-to-center distance between pads
  width: 0.5, // pad height (Y direction)
  padLength: 0.8, // pad width (X direction, along jumper axis)
  padWidth: 0.5, // pad height (Y direction, perpendicular to jumper)
};

export const JUMPER_DIMENSIONS: Record<JumperFootprint, typeof JUMPER_0603> = {
  "0603": JUMPER_0603,
  "1206": JUMPER_1206,
  "1206x4_pair": JUMPER_1206X4_PAIR,
};
