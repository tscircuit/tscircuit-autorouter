import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { HyperSingleIntraNodeSolver } from "./HyperSingleIntraNodeSolver"

type HyperSingleIntraNodeSolverParams = ConstructorParameters<
  typeof HyperSingleIntraNodeSolver
>[0]

export type GrowShrinkHighDensityIntraNodeSolverParams =
  HyperSingleIntraNodeSolverParams & {
    maxGrowthAttempts?: number
  }

const scalePoint = <T extends { x: number; y: number }>(
  point: T,
  center: { x: number; y: number },
  scaleFactor: number,
): T => ({
  ...point,
  x: center.x + (point.x - center.x) * scaleFactor,
  y: center.y + (point.y - center.y) * scaleFactor,
})

const scalePortPoint = (
  portPoint: PortPoint,
  center: { x: number; y: number },
  scaleFactor: number,
): PortPoint => scalePoint(portPoint, center, scaleFactor)

const scaleNodeWithPortPoints = (
  node: NodeWithPortPoints,
  scaleFactor: number,
): NodeWithPortPoints => ({
  ...node,
  width: node.width * scaleFactor,
  height: node.height * scaleFactor,
  portPoints: node.portPoints.map((portPoint) =>
    scalePortPoint(portPoint, node.center, scaleFactor),
  ),
  portPointsInPairs: node.portPointsInPairs?.map(([start, end]) => [
    scalePortPoint(start, node.center, scaleFactor),
    scalePortPoint(end, node.center, scaleFactor),
  ]),
})

const scaleRoute = (
  route: HighDensityIntraNodeRoute,
  center: { x: number; y: number },
  scaleFactor: number,
): HighDensityIntraNodeRoute => ({
  ...route,
  route: route.route.map((point) => scalePoint(point, center, scaleFactor)),
  vias: route.vias.map((via) => scalePoint(via, center, scaleFactor)),
  jumpers: route.jumpers?.map((jumper) => ({
    ...jumper,
    start: scalePoint(jumper.start, center, scaleFactor),
    end: scalePoint(jumper.end, center, scaleFactor),
  })),
})

export class GrowShrinkHighDensityIntraNodeSolver extends BaseSolver {
  override getSolverName(): string {
    return "GrowShrinkHighDensityIntraNodeSolver"
  }

  constructorParams: GrowShrinkHighDensityIntraNodeSolverParams
  nodeWithPortPoints: NodeWithPortPoints
  solvedRoutes: HighDensityIntraNodeRoute[] = []
  failedSolvers: HyperSingleIntraNodeSolver[] = []
  activeSubSolver: HyperSingleIntraNodeSolver | null = null
  winningSolver?: HyperSingleIntraNodeSolver
  scaleFactor = 1
  growthAttempts = 0
  maxGrowthAttempts: number

  constructor(params: GrowShrinkHighDensityIntraNodeSolverParams) {
    super()
    this.constructorParams = params
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.maxGrowthAttempts = params.maxGrowthAttempts ?? 8
    this.MAX_ITERATIONS =
      20_000_000 * (params.effort ?? 1) * (this.maxGrowthAttempts + 1)
  }

  getConstructorParams() {
    return this.constructorParams
  }

  private createActiveSubSolver() {
    this.activeSubSolver = new HyperSingleIntraNodeSolver({
      ...this.constructorParams,
      nodeWithPortPoints: scaleNodeWithPortPoints(
        this.nodeWithPortPoints,
        this.scaleFactor,
      ),
    })
  }

  private acceptSolution(solver: HyperSingleIntraNodeSolver) {
    this.winningSolver = solver
    this.solvedRoutes =
      this.scaleFactor === 1
        ? solver.solvedRoutes
        : solver.solvedRoutes.map((route) =>
            scaleRoute(
              route,
              this.nodeWithPortPoints.center,
              1 / this.scaleFactor,
            ),
          )
    this.solved = true
    this.failed = false
  }

  computeProgress() {
    return Math.min(
      0.99,
      (this.growthAttempts + (this.activeSubSolver?.progress ?? 0)) /
        (this.maxGrowthAttempts + 1),
    )
  }

  _step() {
    if (!this.activeSubSolver) {
      this.createActiveSubSolver()
    }

    this.activeSubSolver!.step()

    if (this.activeSubSolver!.solved) {
      this.acceptSolution(this.activeSubSolver!)
      this.activeSubSolver = null
      return
    }

    if (!this.activeSubSolver!.failed) {
      return
    }

    this.failedSolvers.push(this.activeSubSolver!)
    this.error = this.activeSubSolver!.error
    this.activeSubSolver = null

    if (this.growthAttempts >= this.maxGrowthAttempts) {
      this.failed = true
      this.error = `GrowShrinkHighDensityIntraNodeSolver failed after ${this.maxGrowthAttempts} growth attempts. Last scale factor: ${this.scaleFactor}. Last error: ${this.error}`
      return
    }

    this.growthAttempts++
    this.scaleFactor *= 2
  }

  visualize(): GraphicsObject {
    return (
      this.activeSubSolver?.visualize() ??
      this.winningSolver?.visualize() ?? {
        lines: [],
        points: [],
        rects: [],
        circles: [],
      }
    )
  }
}
