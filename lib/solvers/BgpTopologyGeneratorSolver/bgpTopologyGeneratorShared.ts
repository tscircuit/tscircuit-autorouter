import {
  doBoundsOverlap,
  getBoundFromCenteredRect,
  getBoundingBox,
} from "@tscircuit/math-utils"
import type { Bounds } from "@tscircuit/math-utils"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

const CORNER_SPLIT_RATIO = 0.25
const MIN_AXIS_EPSILON = 1e-6

type RectRegion = {
  center: { x: number; y: number }
  width: number
  height: number
}

type CreateMeshNodesForSrjParams = {
  bounds: SimpleRouteJson["bounds"]
  obstacles: Obstacle[]
  availableZ: number[]
  layerCount: number
  nodeScopeId: string
  rowCount: number
  colCount: number
}

/** Converts bounds into the centered-rectangle representation used by routing regions. */
function createRectRegion(bounds: Bounds): RectRegion {
  return {
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  }
}

function getTopologyAxisObstacles({
  bounds,
  obstacles,
}: {
  bounds: Bounds
  obstacles: Obstacle[]
}) {
  return obstacles.filter((obstacle) =>
    doBoundsOverlap(getBoundingBox(obstacle), bounds),
  )
}

function clusterBoundaryValues(values: number[]) {
  return clusterAxisValues(values)
}

/** Resolves the obstacle's traversable z values from explicit `zLayers` or named layers. */
function getObstacleAvailableZ(obstacle: Obstacle, layerCount: number) {
  return obstacle.zLayers && obstacle.zLayers.length > 0
    ? obstacle.zLayers
    : obstacle.layers.map((layerName) => mapLayerNameToZ(layerName, layerCount))
}

/**
 * Returns true when a routing region overlaps obstacle geometry on at least one
 * of the candidate z layers.
 */
function regionContainsObstacle({
  region,
  obstacle,
  availableZ,
  layerCount,
}: {
  region: RectRegion
  obstacle: Obstacle
  availableZ: number[]
  layerCount: number
}) {
  const regionBounds = getBoundFromCenteredRect(region)
  const obstacleBounds = getBoundingBox(obstacle)

  if (!doBoundsOverlap(regionBounds, obstacleBounds)) {
    return false
  }

  const overlapWidth =
    Math.min(regionBounds.maxX, obstacleBounds.maxX) -
    Math.max(regionBounds.minX, obstacleBounds.minX)
  const overlapHeight =
    Math.min(regionBounds.maxY, obstacleBounds.maxY) -
    Math.max(regionBounds.minY, obstacleBounds.minY)

  if (overlapWidth <= MIN_AXIS_EPSILON || overlapHeight <= MIN_AXIS_EPSILON) {
    return false
  }

  const obstacleAvailableZ = getObstacleAvailableZ(obstacle, layerCount)
  return availableZ.some((z) => obstacleAvailableZ.includes(z))
}

/** Convenience wrapper for deciding whether a region must be treated as obstacle-occupied. */
function regionContainsAnyObstacle({
  region,
  obstacles,
  availableZ,
  layerCount,
}: {
  region: RectRegion
  obstacles: Obstacle[]
  availableZ: number[]
  layerCount: number
}) {
  return obstacles.some((obstacle) =>
    regionContainsObstacle({
      region,
      obstacle,
      availableZ,
      layerCount,
    }),
  )
}

/**
 * Creates a routing region node. This node describes routable area metadata,
 * not the original physical obstacle geometry.
 */
function createMeshNode({
  nodeId,
  region,
  availableZ,
  obstacles,
  layerCount,
}: {
  nodeId: string
  region: RectRegion
  availableZ: number[]
  obstacles?: Obstacle[]
  layerCount?: number
}): CapacityMeshNode {
  return {
    capacityMeshNodeId: nodeId,
    center: region.center,
    width: region.width,
    height: region.height,
    layer: `z${availableZ.join(",")}`,
    availableZ,
    _containsObstacle:
      obstacles && layerCount !== undefined
        ? obstacles.some((obstacle) =>
            regionContainsObstacle({
              region,
              obstacle,
              availableZ,
              layerCount,
            }),
          )
        : undefined,
  }
}

/**
 * Fallback topology used when obstacle clustering does not produce a grid.
 *
 * Diagonal regions normally span all available layers, but if they overlap an
 * obstacle they are split into one region per layer so obstacle-occupied space
 * does not remain a combined multi-layer node.
 */
function createFallbackRingNodes({
  bounds,
  obstacles,
  availableZ,
  layerCount,
  nodeScopeId,
}: {
  bounds: SimpleRouteJson["bounds"]
  obstacles: Obstacle[]
  availableZ: number[]
  layerCount: number
  nodeScopeId: string
}) {
  const x1 = bounds.minX + (bounds.maxX - bounds.minX) * CORNER_SPLIT_RATIO
  const x2 = bounds.maxX - (bounds.maxX - bounds.minX) * CORNER_SPLIT_RATIO
  const y1 = bounds.minY + (bounds.maxY - bounds.minY) * CORNER_SPLIT_RATIO
  const y2 = bounds.maxY - (bounds.maxY - bounds.minY) * CORNER_SPLIT_RATIO

  const diagonalBounds = [
    {
      key: "nw",
      bounds: { minX: bounds.minX, maxX: x1, minY: bounds.minY, maxY: y1 },
    },
    {
      key: "ne",
      bounds: { minX: x2, maxX: bounds.maxX, minY: bounds.minY, maxY: y1 },
    },
    {
      key: "se",
      bounds: { minX: x2, maxX: bounds.maxX, minY: y2, maxY: bounds.maxY },
    },
    {
      key: "sw",
      bounds: { minX: bounds.minX, maxX: x1, minY: y2, maxY: bounds.maxY },
    },
  ] as const

  const sideBounds = [
    {
      key: "top",
      bounds: { minX: x1, maxX: x2, minY: bounds.minY, maxY: y1 },
    },
    {
      key: "right",
      bounds: { minX: x2, maxX: bounds.maxX, minY: y1, maxY: y2 },
    },
    {
      key: "bottom",
      bounds: { minX: x1, maxX: x2, minY: y2, maxY: bounds.maxY },
    },
    {
      key: "left",
      bounds: { minX: bounds.minX, maxX: x1, minY: y1, maxY: y2 },
    },
  ] as const

  return [
    ...diagonalBounds.flatMap(({ key, bounds }) => {
      const region = createRectRegion(bounds)
      const shouldSplitByLayer = regionContainsAnyObstacle({
        region,
        obstacles,
        availableZ,
        layerCount,
      })

      if (!shouldSplitByLayer) {
        return [
          createMeshNode({
            nodeId: `bgp:${nodeScopeId}:diag:${key}`,
            region,
            availableZ: [...availableZ],
            obstacles,
            layerCount,
          }),
        ]
      }

      return availableZ.map((z) =>
        createMeshNode({
          nodeId: `bgp:${nodeScopeId}:diag:${key}:z${z}`,
          region,
          availableZ: [z],
          obstacles,
          layerCount,
        }),
      )
    }),
    ...sideBounds.flatMap(({ key, bounds }) =>
      availableZ.map((z) =>
        createMeshNode({
          nodeId: `bgp:${nodeScopeId}:side:${key}:z${z}`,
          region: createRectRegion(bounds),
          availableZ: [z],
          obstacles,
          layerCount,
        }),
      ),
    ),
  ]
}

function createGridAxisEdges({
  start,
  end,
  obstacles,
  axis,
}: {
  start: number
  end: number
  obstacles: Obstacle[]
  axis: "x" | "y"
}) {
  const rawEdges = [start, end]

  for (const obstacle of obstacles) {
    if (axis === "x") {
      rawEdges.push(
        obstacle.center.x - obstacle.width / 2,
        obstacle.center.x + obstacle.width / 2,
      )
      continue
    }

    rawEdges.push(
      obstacle.center.y - obstacle.height / 2,
      obstacle.center.y + obstacle.height / 2,
    )
  }

  return clusterBoundaryValues(rawEdges)
}

function createCellRegion({
  row,
  col,
  xEdges,
  yEdges,
}: {
  row: number
  col: number
  xEdges: number[]
  yEdges: number[]
}): RectRegion {
  return createRectRegion({
    minX: xEdges[col]!,
    maxX: xEdges[col + 1]!,
    minY: yEdges[row]!,
    maxY: yEdges[row + 1]!,
  })
}

function getExactObstacleForRegion({
  region,
  obstacles,
}: {
  region: RectRegion
  obstacles: Obstacle[]
}) {
  const regionBounds = getBoundFromCenteredRect(region)

  return (
    obstacles.find((obstacle) => {
      const obstacleBounds = getBoundingBox(obstacle)
      return (
        Math.abs(regionBounds.minX - obstacleBounds.minX) <= MIN_AXIS_EPSILON &&
        Math.abs(regionBounds.maxX - obstacleBounds.maxX) <= MIN_AXIS_EPSILON &&
        Math.abs(regionBounds.minY - obstacleBounds.minY) <= MIN_AXIS_EPSILON &&
        Math.abs(regionBounds.maxY - obstacleBounds.maxY) <= MIN_AXIS_EPSILON
      )
    }) ?? null
  )
}

function isFreeSpaceCellSurroundedByDiagonalObstacles({
  row,
  col,
  xEdges,
  yEdges,
  obstacles,
}: {
  row: number
  col: number
  xEdges: number[]
  yEdges: number[]
  obstacles: Obstacle[]
}) {
  if (
    row <= 0 ||
    col <= 0 ||
    row >= yEdges.length - 2 ||
    col >= xEdges.length - 2
  ) {
    return false
  }

  const diagonalCells = [
    { row: row - 1, col: col - 1 },
    { row: row - 1, col: col + 1 },
    { row: row + 1, col: col - 1 },
    { row: row + 1, col: col + 1 },
  ]

  return diagonalCells.every(({ row: diagonalRow, col: diagonalCol }) =>
    Boolean(
      getExactObstacleForRegion({
        region: createCellRegion({
          row: diagonalRow,
          col: diagonalCol,
          xEdges,
          yEdges,
        }),
        obstacles,
      }),
    ),
  )
}

/**
 * Creates routing regions for one exact rectangular partition cell.
 *
 * Cells are carved from board bounds and obstacle boundaries, so obstacle
 * rectangles remain exact and free-space cells are built around them.
 */
function createCellMeshNodes({
  row,
  col,
  xEdges,
  yEdges,
  availableZ,
  obstacles,
  layerCount,
  nodeScopeId,
}: {
  row: number
  col: number
  xEdges: number[]
  yEdges: number[]
  availableZ: number[]
  obstacles: Obstacle[]
  layerCount: number
  nodeScopeId: string
}): CapacityMeshNode[] {
  const region = createCellRegion({
    row,
    col,
    xEdges,
    yEdges,
  })

  const exactObstacle = getExactObstacleForRegion({
    region,
    obstacles,
  })

  if (exactObstacle) {
    return [
      createMeshNode({
        nodeId: `bgp:${nodeScopeId}:r${row}:c${col}:obstacle`,
        region,
        availableZ: [...availableZ],
        obstacles: [exactObstacle],
        layerCount,
      }),
    ]
  }

  if (
    isFreeSpaceCellSurroundedByDiagonalObstacles({
      row,
      col,
      xEdges,
      yEdges,
      obstacles,
    })
  ) {
    return [
      createMeshNode({
        nodeId: `bgp:${nodeScopeId}:r${row}:c${col}:free-multilayer`,
        region,
        availableZ: [...availableZ],
        obstacles,
        layerCount,
      }),
    ]
  }

  return availableZ.map((z) =>
    createMeshNode({
      nodeId: `bgp:${nodeScopeId}:r${row}:c${col}:z${z}`,
      region,
      availableZ: [z],
      obstacles,
      layerCount,
    }),
  )
}

/** Clusters nearly-equal axis values so pad-center jitter does not create extra rows/columns. */
export function clusterAxisValues(values: number[]) {
  const sortedValues = [...values].sort((a, b) => a - b)
  const gaps: number[] = []

  for (let index = 1; index < sortedValues.length; index++) {
    const gap = sortedValues[index]! - sortedValues[index - 1]!
    if (gap > MIN_AXIS_EPSILON) gaps.push(gap)
  }

  const tolerance =
    gaps.length > 0 ? Math.max(MIN_AXIS_EPSILON, Math.min(...gaps) / 4) : 1e-3
  const clustered: number[] = []

  for (const value of sortedValues) {
    const previousValue = clustered[clustered.length - 1]
    if (
      previousValue === undefined ||
      Math.abs(value - previousValue) > tolerance
    ) {
      clustered.push(value)
    }
  }

  return clustered
}

/** Returns `[0..layerCount-1]` for the solver's z-axis iteration. */
export function getLayerRange(layerCount: number) {
  return Array.from({ length: Math.max(0, layerCount) }, (_, z) => z)
}

/**
 * Generates routing regions from obstacle centers and board bounds.
 *
 * The returned nodes are routing cells for later topology/pathing stages.
 * They intentionally do not try to mirror exact obstacle rectangles.
 */
export function createMeshNodesForSrj({
  bounds,
  obstacles,
  availableZ,
  layerCount,
  nodeScopeId,
  rowCount,
  colCount,
}: CreateMeshNodesForSrjParams): CapacityMeshNode[] {
  if (rowCount === 0 || colCount === 0) {
    return createFallbackRingNodes({
      bounds,
      obstacles,
      availableZ,
      layerCount,
      nodeScopeId,
    })
  }

  const axisObstacles = getTopologyAxisObstacles({ bounds, obstacles })
  const xEdges = createGridAxisEdges({
    start: bounds.minX,
    end: bounds.maxX,
    obstacles: axisObstacles,
    axis: "x",
  })
  const yEdges = createGridAxisEdges({
    start: bounds.minY,
    end: bounds.maxY,
    obstacles: axisObstacles,
    axis: "y",
  })
  const meshNodes: CapacityMeshNode[] = []

  for (let row = 0; row < yEdges.length - 1; row++) {
    for (let col = 0; col < xEdges.length - 1; col++) {
      meshNodes.push(
        ...createCellMeshNodes({
          row,
          col,
          xEdges,
          yEdges,
          availableZ,
          obstacles,
          layerCount,
          nodeScopeId,
        }),
      )
    }
  }

  return meshNodes
}
