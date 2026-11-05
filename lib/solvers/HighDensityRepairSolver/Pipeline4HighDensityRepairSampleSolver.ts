import { SolverRuntime } from "@tscircuit/solver-utils"
import type { DatasetSample, HdRoute } from "high-density-repair02"
import { getRouteObstacleClearance } from "high-density-repair02/lib/high-density-repair-solver/functions/repairNodeClearance"
import { buildRepairFrames } from "high-density-repair02/lib/high-density-repair-solver/steps/buildRepairFrames"
import { BaseSolver } from "../BaseSolver"

export const shouldRetryWithBoundaryDiagonalRepair = (
  sample: DatasetSample,
  repairedRoutes: HdRoute[],
  finalConflictCount: number,
): boolean => {
  if (finalConflictCount <= 0) return false
  const node = sample.nodeWithPortPoints
  if (!node?.center || node.width === undefined || node.height === undefined) {
    return false
  }
  const clearanceObstacles = sample.clearanceObstacles ?? []
  if (
    clearanceObstacles.length === 0 ||
    clearanceObstacles.some(
      (obstacle) => (obstacle.connectedTo?.length ?? 0) > 0,
    )
  ) {
    return false
  }

  const minX = node.center.x - node.width / 2
  const maxX = node.center.x + node.width / 2
  const minY = node.center.y - node.height / 2
  const maxY = node.center.y + node.height / 2
  const wallTolerance = 1e-3

  return repairedRoutes.some((route) => {
    const points = route.route ?? []
    if (points.length <= 2 || (route.vias?.length ?? 0) > 0) return false
    const start = points[0]!
    const end = points[points.length - 1]!
    if ((start.z ?? 0) !== (end.z ?? 0)) return false
    const onSameWall =
      (Math.abs(start.x - minX) <= wallTolerance &&
        Math.abs(end.x - minX) <= wallTolerance) ||
      (Math.abs(start.x - maxX) <= wallTolerance &&
        Math.abs(end.x - maxX) <= wallTolerance) ||
      (Math.abs(start.y - minY) <= wallTolerance &&
        Math.abs(end.y - minY) <= wallTolerance) ||
      (Math.abs(start.y - maxY) <= wallTolerance &&
        Math.abs(end.y - maxY) <= wallTolerance)
    if (!onSameWall) return false
    return clearanceObstacles.some(
      (obstacle) => getRouteObstacleClearance(route, obstacle) < 0.1 - 1e-6,
    )
  })
}

export type Pipeline4HighDensityRepairSampleInput = {
  sample: DatasetSample
  margin: number
}

export type Pipeline4HighDensityRepairSampleOutput = {
  repairedRoutes: HdRoute[]
  clearanceStats: ReturnType<typeof buildRepairFrames>["clearanceRepairStats"]
}

/** Node samples all read the original geometry; acceptance remains in node order. */
export class Pipeline4HighDensityRepairSampleSolver extends BaseSolver {
  static readonly solverName: string = "Pipeline4HighDensityRepairSampleSolver"
  private output?: Pipeline4HighDensityRepairSampleOutput

  constructor(private readonly input: Pipeline4HighDensityRepairSampleInput) {
    super()
  }

  override _step(): void {
    let result = buildRepairFrames(
      this.input.sample,
      this.input.margin,
      false,
      false,
    )
    if (
      shouldRetryWithBoundaryDiagonalRepair(
        this.input.sample,
        result.repairedRoutes,
        Number(
          result.clearanceRepairStats?.nodeClearanceFinalConflictCount ?? 0,
        ),
      )
    ) {
      const boundaryResult = buildRepairFrames(
        this.input.sample,
        this.input.margin,
        false,
        true,
      )
      if (
        (boundaryResult.clearanceRepairStats?.nodeClearanceFinalConflictCount ??
          Infinity) <
        (result.clearanceRepairStats?.nodeClearanceFinalConflictCount ??
          Infinity)
      ) {
        result = boundaryResult
      }
    }
    if (result.frames.length !== 1) {
      throw new Error("Node repair must complete in one frame")
    }
    // The wrapper's trace diagnostics and visualization do not affect repairs.
    this.output = {
      repairedRoutes: result.repairedRoutes,
      clearanceStats: result.clearanceRepairStats,
    }
    this.solved = true
  }

  getOutput(): Pipeline4HighDensityRepairSampleOutput {
    if (!this.output) throw new Error("Node repair sample has not completed")
    return this.output
  }
}

SolverRuntime.registerSolver(Pipeline4HighDensityRepairSampleSolver)
