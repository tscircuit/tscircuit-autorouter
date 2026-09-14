import { SpecializedIntraNodeSolverAdapter } from "lib/bindings/high-density/SpecializedIntraNodeSolverAdapter"
import {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
type Point = {
  x: number
  y: number
  z?: number
}
type Route = {
  A: Point
  B: Point
  connectionName: string
}
export class SingleTransitionCrossingRouteSolver extends SpecializedIntraNodeSolverAdapter {
  static override solverKind = "transition-crossing"
  static override diagnosticFields = [
    "nodeWithPortPoints",
    "routes",
    "viaDiameter",
    "traceThickness",
    "obstacleMargin",
    "layerCount",
    "debugViaPositions",
    "solvedRoutes",
    "bounds",
  ]
  override getSolverName(): string {
    return "SingleTransitionCrossingRouteSolver"
  }
  declare nodeWithPortPoints: NodeWithPortPoints
  declare routes: Route[]
  declare viaDiameter: number
  declare traceThickness: number
  declare obstacleMargin: number
  declare layerCount: number
  declare debugViaPositions: {
    via: Point
  }[]
  declare solvedRoutes: HighDensityIntraNodeRoute[]
  declare bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  }
  constructor(props: {
    nodeWithPortPoints: NodeWithPortPoints
    viaDiameter?: number
    traceThickness?: number
    obstacleMargin?: number
    layerCount?: number
  }) {
    super(props)
  }
  getSolvedRoutes(): HighDensityIntraNodeRoute[] {
    return this.solvedRoutes
  }
}
