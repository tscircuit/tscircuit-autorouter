/**
 * Estimates the dimensions of a 0603 jumper grid for a given configuration.
 *
 * Grid generation uses generateJumperGrid where cols directly controls width.
 * For horizontal orientation, _generate0603Grid swaps: effectiveCols = ROWS.
 *
 * Empirically measured with margin=0.5:
 * - 1 col = 2.45 wide, 4 cols = 11.3 wide → width = 2.45 + (cols-1)*2.95
 * - 15 rows = 21.26 tall → height = rows * 1.42
 */

// Grid size constants (empirically measured with margin=0.5)
const BASE_WIDTH = 2.45
const ADDITIONAL_WIDTH_PER_COL = 2.95
const HEIGHT_PER_ROW = 1.42

/**
 * Estimates the pad bounds dimensions for a 0603 grid configuration.
 * @param cols - Number of columns in generateJumperGrid (effectiveCols for the grid)
 * @param rows - Number of rows in generateJumperGrid (effectiveRows for the grid)
 * @returns Estimated width and height of the pad bounds
 */
export function estimate0603GridDimensions(
  cols: number,
  rows: number,
): { width: number; height: number } {
  // width = baseWidth + (cols-1) * additionalWidthPerCol
  const width = BASE_WIDTH + (cols - 1) * ADDITIONAL_WIDTH_PER_COL
  // height = rows * heightPerRow
  const height = rows * HEIGHT_PER_ROW
  return { width, height }
}

/**
 * Calculate max rows and cols for 0603 jumpers that fit in the given bounds.
 *
 * @param nodeWidth - Width of the node
 * @param nodeHeight - Height of the node
 * @param orientation - "vertical" or "horizontal"
 * @param paddingRequirement - Padding needed on each side (default 0.5)
 * @returns The max COLS and ROWS parameters for the JumperPrepatternSolver
 */
export function calculateMax0603Config(
  nodeWidth: number,
  nodeHeight: number,
  orientation: "horizontal" | "vertical",
  paddingRequirement: number = 0.5,
): { cols: number; rows: number } {
  // Available space after padding requirement on each side
  const availableWidth = nodeWidth - 2 * paddingRequirement
  const availableHeight = nodeHeight - 2 * paddingRequirement

  // Calculate max cols that fit in width: availableWidth >= 2.45 + (cols-1)*2.95
  // cols <= 1 + (availableWidth - 2.45) / 2.95
  const maxColsFromWidth = Math.max(
    1,
    Math.floor(1 + (availableWidth - BASE_WIDTH) / ADDITIONAL_WIDTH_PER_COL),
  )

  // Calculate max rows that fit in height: availableHeight >= rows * 1.42
  const maxRowsFromHeight = Math.max(
    1,
    Math.floor(availableHeight / HEIGHT_PER_ROW),
  )

  if (orientation === "vertical") {
    // Vertical: COLS controls width, ROWS controls height
    return { cols: maxColsFromWidth, rows: maxRowsFromHeight }
  } else {
    // Horizontal: effectiveCols = ROWS (controls width), effectiveRows = COLS (controls height)
    // So ROWS parameter controls width (use maxColsFromWidth), COLS controls height (use maxRowsFromHeight)
    return { cols: maxRowsFromHeight, rows: maxColsFromWidth }
  }
}
