import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

export interface ApproximateLayerTransitionSolverParams {
  hdRoutes: ReadonlyArray<HighDensityRoute>
}

const POINT_EPSILON = 1e-9

const materializeLayerTransitions = (
  route: HighDensityRoute,
): { route: HighDensityRoute; materializedTransitionCount: number } => {
  const points: HighDensityRoute["route"] = []
  let materializedTransitionCount = 0
  for (const point of route.route) {
    const previousPoint = points.at(-1)
    if (
      previousPoint &&
      previousPoint.z !== point.z &&
      (Math.abs(previousPoint.x - point.x) > POINT_EPSILON ||
        Math.abs(previousPoint.y - point.y) > POINT_EPSILON)
    ) {
      points.push({ ...point, z: previousPoint.z })
      materializedTransitionCount++
    }
    points.push({ ...point })
  }

  const vias: HighDensityRoute["vias"] = []
  const viaLocationKeys = new Set<string>()
  for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex++) {
    const start = points[pointIndex]!
    const end = points[pointIndex + 1]!
    if (
      start.z !== end.z &&
      Math.abs(start.x - end.x) <= POINT_EPSILON &&
      Math.abs(start.y - end.y) <= POINT_EPSILON
    ) {
      const viaLocationKey = `${end.x}:${end.y}`
      if (viaLocationKeys.has(viaLocationKey)) continue
      viaLocationKeys.add(viaLocationKey)
      vias.push({ x: end.x, y: end.y })
    }
  }

  return {
    route: { ...route, route: points, vias },
    materializedTransitionCount,
  }
}

export class ApproximateLayerTransitionSolver extends BaseSolver {
  readonly params: ApproximateLayerTransitionSolverParams
  outputRoutes: HighDensityRoute[] = []

  constructor(params: ApproximateLayerTransitionSolverParams) {
    super()
    this.params = params
    this.MAX_ITERATIONS = 1
  }

  override getSolverName(): string {
    return "ApproximateLayerTransitionSolver"
  }

  override getConstructorParams(): [ApproximateLayerTransitionSolverParams] {
    return [this.params]
  }

  override _step(): void {
    let materializedTransitionCount = 0
    this.outputRoutes = this.params.hdRoutes.map((route) => {
      const normalized = materializeLayerTransitions(route)
      materializedTransitionCount += normalized.materializedTransitionCount
      return normalized.route
    })
    this.stats.materializedTransitionCount = materializedTransitionCount
    this.solved = true
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved) {
      throw new Error(
        "ApproximateLayerTransitionSolver output requested before solve",
      )
    }
    return this.outputRoutes
  }

  override visualize(): GraphicsObject {
    return {
      title: "Pipeline10 materialized layer transitions",
      lines: this.outputRoutes.flatMap((route) =>
        route.route.slice(0, -1).map((point, pointIndex) => ({
          points: [point, route.route[pointIndex + 1]!],
          strokeWidth: route.traceThickness,
          strokeColor: point.z === 0 ? "#dc2626" : "#2563eb",
          layer: `z${point.z}`,
          label: route.connectionName,
        })),
      ),
      circles: this.outputRoutes.flatMap((route) =>
        route.vias.map((via) => ({
          center: via,
          radius: route.viaDiameter / 2,
          fill: "#7c3aed",
          label: route.connectionName,
        })),
      ),
      points: [],
      rects: [],
    }
  }
}
