import { BaseSolver } from "@tscircuit/solver-utils"
import { doBoundsOverlap, getBoundingBox } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import { getStringColor, safeTransparentize } from "lib/solvers/colors"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import {
  clusterAxisValues,
  createMeshNodesForSrj,
  getLayerRange,
} from "./bgpTopologyGeneratorShared"

export interface BgaTopologyGeneratorSolverParams {
  inputSrj: SimpleRouteJson
  componentId?: string
  replacementObstacleId?: string
}

export interface BgaTopologyGeneratorSolverOutput {
  /** Exact obstacle rectangles cloned from the input SRJ. This is the geometry source of truth. */
  obstacles: Obstacle[]
  /** Routing regions derived from obstacle layout. These are not obstacle rectangles. */
  routingRegions: CapacityMeshNode[]
}

const createBoardVisualization = (
  bounds: SimpleRouteJson["bounds"],
): GraphicsObject => ({
  rects: [
    {
      center: {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      },
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      fill: "rgba(0, 0, 0, 0)",
      stroke: "rgba(40, 40, 40, 0.7)",
      label: "Board bounds",
    },
  ],
  lines: [],
  points: [],
  circles: [],
})

const createObstacleVisualization = ({
  srj,
  activeBounds,
}: {
  srj: SimpleRouteJson
  activeBounds?: SimpleRouteJson["bounds"]
}): GraphicsObject => {
  const baseGraphics = convertSrjToGraphicsObject(srj)

  return {
    ...baseGraphics,
    rects: (baseGraphics.rects ?? []).map((rect, index) => {
      const obstacle = srj.obstacles[index]
      if (!obstacle) return rect

      const color = obstacle.componentId
        ? getStringColor(obstacle.componentId)
        : "#7c8899"
      const isInActiveBounds = activeBounds
        ? doBoundsOverlap(getBoundingBox(obstacle), activeBounds)
        : true

      return {
        ...rect,
        fill: safeTransparentize(color, isInActiveBounds ? 0.72 : 0.9),
        stroke: safeTransparentize(color, isInActiveBounds ? 0.28 : 0.5),
        label:
          obstacle.componentId && obstacle.obstacleId
            ? `${obstacle.componentId}\n${obstacle.obstacleId}`
            : (obstacle.componentId ?? obstacle.obstacleId ?? rect.label),
        layer: obstacle.layers.join(","),
      }
    }),
  }
}

const createRoutingRegionVisualization = (
  routingRegions: CapacityMeshNode[],
): GraphicsObject => ({
  rects: routingRegions.map((node) => {
    const containsObstacle = Boolean(node._containsObstacle)
    const baseColor = containsObstacle ? "#c53030" : "#1f7a8c"

    return {
      ...createRectFromCapacityNode(node, { rectMargin: 0.01 }),
      fill: safeTransparentize(baseColor, containsObstacle ? 0.84 : 0.9),
      stroke: safeTransparentize(baseColor, containsObstacle ? 0.2 : 0.28),
      label: `${node.capacityMeshNodeId}\nz:${node.availableZ.join(",")}`,
    }
  }),
  lines: [],
  points: [],
  circles: [],
})

/**
 * Builds a coarse topology for BGA-style routing from an SRJ obstacle field.
 *
 * Important:
 * - `obstacles` in the output preserve the original SRJ geometry exactly.
 * - `routingRegions` are derived routing cells and may be larger than pads.
 * - obstacle-overlapping regions are split per layer instead of being emitted
 *   as one multi-layer region.
 */
export class BgaTopologyGeneratorSolver extends BaseSolver {
  private output: BgaTopologyGeneratorSolverOutput | null = null

  constructor(public readonly inputProblem: BgaTopologyGeneratorSolverParams) {
    super()
  }

  override getConstructorParams() {
    return [this.inputProblem] as const
  }

  initialVisualize(): GraphicsObject | null {
    const { bounds, obstacles } = this.inputProblem.inputSrj

    return {
      ...combineVisualizations(
        createBoardVisualization(bounds),
        createObstacleVisualization({
          srj: { ...this.inputProblem.inputSrj, obstacles },
          activeBounds: bounds,
        }),
      ),
      title: "BGA Topology: board and related component pads",
    }
  }

  /** Solves in one pass because the topology is derived directly from the input SRJ. */
  override _step() {
    if (this.output) {
      this.solved = true
      return
    }

    const { bounds, layerCount, obstacles } = this.inputProblem.inputSrj
    const topologyAxisObstacles = obstacles.filter((obstacle) =>
      doBoundsOverlap(getBoundingBox(obstacle), bounds),
    )
    const availableZ = getLayerRange(layerCount)
    const nodeScopeId =
      this.inputProblem.componentId ??
      this.inputProblem.replacementObstacleId ??
      "component"
    const rowCount = clusterAxisValues(
      topologyAxisObstacles.map((obstacle) => obstacle.center.y),
    ).length
    const colCount = clusterAxisValues(
      topologyAxisObstacles.map((obstacle) => obstacle.center.x),
    ).length
    const meshNodes = createMeshNodesForSrj({
      bounds,
      obstacles,
      availableZ,
      layerCount,
      nodeScopeId,
      rowCount,
      colCount,
    })
    const diagonalNodeCount = meshNodes.filter(
      (node) => node.availableZ.length > 1,
    ).length

    const clonedObstacles = obstacles.map((obstacle) =>
      structuredClone(obstacle),
    )
    this.output = {
      obstacles: clonedObstacles,
      routingRegions: meshNodes,
    }
    this.stats = {
      componentId: this.inputProblem.componentId ?? null,
      replacementObstacleId: this.inputProblem.replacementObstacleId ?? null,
      layerCount,
      inferredRowCount: rowCount,
      inferredColumnCount: colCount,
      diagonalNodeCount,
      sideNodeCount: meshNodes.length - diagonalNodeCount,
      totalMeshNodeCount: meshNodes.length,
    }
    this.solved = true
  }

  override visualize(): GraphicsObject {
    const { bounds, obstacles } = this.inputProblem.inputSrj
    const output = this.output

    return {
      ...combineVisualizations(
        createBoardVisualization(bounds),
        createObstacleVisualization({
          srj: { ...this.inputProblem.inputSrj, obstacles },
        }),
        createObstacleVisualization({
          srj: { ...this.inputProblem.inputSrj, obstacles },
          activeBounds: bounds,
        }),
        ...(output
          ? [createRoutingRegionVisualization(output.routingRegions)]
          : []),
      ),
      title: output
        ? "BGA Topology: input pads -> active matrix -> routing regions"
        : "BGA Topology: board and candidate matrix",
    }
  }

  getOutput(): BgaTopologyGeneratorSolverOutput {
    if (!this.output) {
      throw new Error("BgaTopologyGeneratorSolver has not solved yet")
    }

    return this.output
  }
}
