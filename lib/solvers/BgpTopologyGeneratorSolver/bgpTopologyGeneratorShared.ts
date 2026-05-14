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

/** Identifies the corner cells of a ring that would otherwise become diagonal nodes. */
function isDiagonalCell({
  row,
  col,
  rowCount,
  colCount,
}: {
  row: number
  col: number
  rowCount: number
  colCount: number
}) {
  const ringIndex = Math.min(row, col, rowCount - 1 - row, colCount - 1 - col)
  const rowMin = ringIndex
  const rowMax = rowCount - 1 - ringIndex
  const colMin = ringIndex
  const colMax = colCount - 1 - ringIndex
  return (
    (row === rowMin || row === rowMax) && (col === colMin || col === colMax)
  )
}

/** Builds cell edges from clustered obstacle centers using midpoint partitioning. */
function createGridAxisEdges({
  start,
  end,
  centers,
}: {
  start: number
  end: number
  centers: number[]
}) {
  const edges = [start]

  for (let index = 0; index < centers.length - 1; index++) {
    edges.push((centers[index]! + centers[index + 1]!) / 2)
  }

  edges.push(end)
  return edges
}

/**
 * Creates routing regions for one grid cell.
 *
 * Diagonal cells are merged across layers only when they do not overlap any
 * obstacle. Obstacle-overlapping diagonal cells are split per layer.
 */
function createCellMeshNodes({
  row,
  col,
  rowCount,
  colCount,
  xEdges,
  yEdges,
  availableZ,
  obstacles,
  layerCount,
  nodeScopeId,
}: {
  row: number
  col: number
  rowCount: number
  colCount: number
  xEdges: number[]
  yEdges: number[]
  availableZ: number[]
  obstacles: Obstacle[]
  layerCount: number
  nodeScopeId: string
}): CapacityMeshNode[] {
  const region = createRectRegion({
    minX: xEdges[col]!,
    maxX: xEdges[col + 1]!,
    minY: yEdges[row]!,
    maxY: yEdges[row + 1]!,
  })

  if (isDiagonalCell({ row, col, rowCount, colCount })) {
    const shouldSplitByLayer = regionContainsAnyObstacle({
      region,
      obstacles,
      availableZ,
      layerCount,
    })

    if (shouldSplitByLayer) {
      return availableZ.map((z) =>
        createMeshNode({
          nodeId: `bgp:${nodeScopeId}:r${row}:c${col}:diag:z${z}`,
          region,
          availableZ: [z],
          obstacles,
          layerCount,
        }),
      )
    }

    return [
      createMeshNode({
        nodeId: `bgp:${nodeScopeId}:r${row}:c${col}:diag`,
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

  const xCenters = clusterAxisValues(
    obstacles.map((obstacle) => obstacle.center.x),
  )
  const yCenters = clusterAxisValues(
    obstacles.map((obstacle) => obstacle.center.y),
  )
  const xEdges = createGridAxisEdges({
    start: bounds.minX,
    end: bounds.maxX,
    centers: xCenters,
  })
  const yEdges = createGridAxisEdges({
    start: bounds.minY,
    end: bounds.maxY,
    centers: yCenters,
  })
  const meshNodes: CapacityMeshNode[] = []

  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < colCount; col++) {
      meshNodes.push(
        ...createCellMeshNodes({
          row,
          col,
          rowCount,
          colCount,
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
