import { doBoundsOverlap, getBoundingBox } from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import {
  TopologyGenerator,
  type TopologyGeneratorSolverOutput,
  type TopologyGeneratorSolverParams,
} from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import type { CapacityMeshNode, Obstacle } from "lib/types"
import {
  clusterAxisValues,
  createMeshNodesForSrj,
  getLayerRange,
} from "./bgpTopologyGeneratorShared"

export interface BgaTopologyGeneratorSolverParams
  extends TopologyGeneratorSolverParams {}

export interface BgaTopologyGeneratorSolverOutput
  extends TopologyGeneratorSolverOutput {
  /** Exact obstacle rectangles cloned from the input SRJ. This is the geometry source of truth. */
  obstacles: Obstacle[]
  /** Routing regions derived from obstacle layout. These are not obstacle rectangles. */
  routingRegions: CapacityMeshNode[]
}

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
  static readonly componentKind = "bga"

  private output: BgaTopologyGeneratorSolverOutput | null = null

  constructor(public readonly inputProblem: BgaTopologyGeneratorSolverParams) {
    super()
  }

  override getConstructorParams() {
    return [this.inputProblem] as const
  }

  /** Solves in one pass because the topology is derived directly from the input SRJ. */
  override _step() {
    if (this.output) {
      this.solved = true
      return
    }

    const { layerCount, obstacles } = this.inputProblem.inputSrj
    const { bounds, componentId } = this.inputProblem.detectedComponent
    const componentObstacles = obstacles.filter(
      (obstacle) => obstacle.componentId === componentId,
    )
    const topologyAxisObstacles =
      componentObstacles.length > 0
        ? componentObstacles
        : obstacles.filter((obstacle) =>
            doBoundsOverlap(getBoundingBox(obstacle), bounds),
          )
    const availableZ = getLayerRange(layerCount)
    const nodeScopeId =
      componentId ?? this.inputProblem.replacementObstacleId ?? "component"
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

    const clonedObstacles = topologyAxisObstacles.map((obstacle) =>
      structuredClone(obstacle),
    )
    this.output = {
      obstacles: clonedObstacles,
      routingRegions: meshNodes,
    }
    this.stats = {
      componentId: componentId ?? null,
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

  getOutput(): BgaTopologyGeneratorSolverOutput {
    if (!this.output) {
      throw new Error("BgaTopologyGeneratorSolver has not solved yet")
    }

    return this.output
  }
}

TopologyGenerator.register(BgaTopologyGeneratorSolver)
