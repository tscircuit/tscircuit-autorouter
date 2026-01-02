import type { JumperPrepatternSolver } from "../JumperPrepatternSolver"
import { JUMPER_DIMENSIONS, JumperFootprint } from "lib/utils/jumperSizes"
import type {
  PatternResult,
  PrepatternJumper,
  Obstacle,
} from "./alternatingGrid"

/**
 * Margin between jumpers along their length direction (same row/column)
 * Needs to be larger to allow traces to pass between jumper ends
 */
const LONG_MARGIN = 1.5

/**
 * Margin between rows/columns (perpendicular to jumper length)
 * Can be smaller since jumpers in adjacent rows are staggered
 */
const SHORT_MARGIN = 0.5

const BORDER_PADDING = 0.8

/**
 * Generates a staggered grid of jumpers where all jumpers have the same orientation.
 * Rows are offset by half the jumper length to create a brick-like pattern.
 *
 * Hyperparameters:
 * - FIRST_ORIENTATION: "horizontal" or "vertical" - determines orientation of ALL jumpers
 */
export function staggeredGrid(jps: JumperPrepatternSolver): PatternResult {
  const prepatternJumpers: PrepatternJumper[] = []
  const jumperPadObstacles: Obstacle[] = []

  const node = jps.nodeWithPortPoints
  const bounds = {
    minX: node.center.x - node.width / 2 + BORDER_PADDING,
    maxX: node.center.x + node.width / 2 - BORDER_PADDING,
    minY: node.center.y - node.height / 2 + BORDER_PADDING,
    maxY: node.center.y + node.height / 2 - BORDER_PADDING,
    width: 0,
    height: 0,
  }
  bounds.width = bounds.maxX - bounds.minX
  bounds.height = bounds.maxY - bounds.minY

  const dims = JUMPER_DIMENSIONS[jps.jumperFootprint]
  const jumperLength = dims.length
  const jumperWidth = dims.width

  // Get hyperparameters with defaults
  const isVertical = jps.hyperParameters.FIRST_ORIENTATION === "vertical"

  // Stagger offset is half the jumper length (for 0603: 1.65mm / 2 = 0.825mm)
  const staggerOffset = jumperLength / 2

  // Cell sizes differ based on direction
  // longStep: spacing along the jumper's length direction (between jumpers in same row)
  // shortStep: spacing perpendicular to jumper length (between rows)
  const longStep = jumperLength + LONG_MARGIN
  const shortStep = jumperWidth + SHORT_MARGIN

  // For horizontal jumpers: columns use longStep (X), rows use shortStep (Y)
  // For vertical jumpers: columns use shortStep (X), rows use longStep (Y)
  const colStep = isVertical ? shortStep : longStep
  const rowStep = isVertical ? longStep : shortStep

  const numCols = Math.floor(bounds.width / colStep)
  const numRows = Math.floor(bounds.height / rowStep)

  let jumperIndex = 0

  const gridOffsetX = (bounds.width - numCols * colStep) / 2
  const gridOffsetY = (bounds.height - numRows * rowStep) / 2

  const createJumperObstacles = (
    jumperId: string,
    start: { x: number; y: number },
    end: { x: number; y: number },
    footprint: JumperFootprint,
    offBoardConnectionId: string,
  ) => {
    const jumperDims = JUMPER_DIMENSIONS[footprint]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const isHoriz = Math.abs(dx) > Math.abs(dy)

    const padWidth = isHoriz ? jumperDims.padLength : jumperDims.padWidth
    const padHeight = isHoriz ? jumperDims.padWidth : jumperDims.padLength

    jumperPadObstacles.push({
      type: "rect",
      obstacleId: `${jumperId}_pad_start`,
      layers: ["top"],
      center: { x: start.x, y: start.y },
      width: padWidth,
      height: padHeight,
      connectedTo: [],
      offBoardConnectsTo: [offBoardConnectionId],
    })

    jumperPadObstacles.push({
      type: "rect",
      obstacleId: `${jumperId}_pad_end`,
      layers: ["top"],
      center: { x: end.x, y: end.y },
      width: padWidth,
      height: padHeight,
      connectedTo: [],
      offBoardConnectsTo: [offBoardConnectionId],
    })
  }

  const jumperOverlapsPortPoint = (
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): boolean => {
    const margin = dims.width / 2 + jps.traceWidth * 2

    for (const pp of jps.nodeWithPortPoints.portPoints) {
      const distToStart = Math.sqrt(
        (pp.x - start.x) ** 2 + (pp.y - start.y) ** 2,
      )
      if (distToStart < margin) return true

      const distToEnd = Math.sqrt((pp.x - end.x) ** 2 + (pp.y - end.y) ** 2)
      if (distToEnd < margin) return true
    }

    return false
  }

  const addJumper = (
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) => {
    // Check bounds
    const maxX = Math.max(start.x, end.x)
    const maxY = Math.max(start.y, end.y)
    const minX = Math.min(start.x, end.x)
    const minY = Math.min(start.y, end.y)

    if (
      minX < bounds.minX ||
      maxX > bounds.maxX ||
      minY < bounds.minY ||
      maxY > bounds.maxY
    ) {
      return false
    }

    if (jumperOverlapsPortPoint(start, end)) {
      return false
    }

    const jumperId = `jumper_${jumperIndex}`
    const offBoardConnectionId = `jumper_conn_${jumperIndex}`

    prepatternJumpers.push({
      jumperId,
      start,
      end,
      footprint: jps.jumperFootprint,
      offBoardConnectionId,
    })

    createJumperObstacles(
      jumperId,
      start,
      end,
      jps.jumperFootprint,
      offBoardConnectionId,
    )

    jumperIndex++
    return true
  }

  for (let row = 0; row < numRows; row++) {
    // Apply stagger offset to alternate rows
    const rowStagger = row % 2 === 1 ? staggerOffset : 0

    for (let col = 0; col < numCols; col++) {
      // Center of this grid cell
      let cellCenterX = bounds.minX + colStep / 2 + col * colStep + gridOffsetX
      let cellCenterY = bounds.minY + rowStep / 2 + row * rowStep + gridOffsetY

      // Apply stagger based on orientation
      if (isVertical) {
        // Vertical jumpers: stagger columns in Y direction
        cellCenterY += col % 2 === 1 ? staggerOffset : 0
      } else {
        // Horizontal jumpers: stagger rows in X direction
        cellCenterX += rowStagger
      }

      let start: { x: number; y: number }
      let end: { x: number; y: number }

      if (isVertical) {
        // Vertical jumper (90°)
        start = { x: cellCenterX, y: cellCenterY - jumperLength / 2 }
        end = { x: cellCenterX, y: cellCenterY + jumperLength / 2 }
      } else {
        // Horizontal jumper (0°)
        start = { x: cellCenterX - jumperLength / 2, y: cellCenterY }
        end = { x: cellCenterX + jumperLength / 2, y: cellCenterY }
      }

      addJumper(start, end)
    }
  }

  return { jumperPadObstacles, prepatternJumpers }
}
