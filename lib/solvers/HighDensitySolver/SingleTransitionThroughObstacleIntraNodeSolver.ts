import { SpecializedIntraNodeSolverAdapter } from "lib/bindings/high-density/SpecializedIntraNodeSolverAdapter"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle } from "lib/types"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
type Route = {
  A: PortPoint
  B: PortPoint
  connectionName: string
  rootConnectionName?: string
}
type LayeredObstacle = Obstacle & {
  __zLayers: number[]
}
export class SingleTransitionThroughObstacleIntraNodeSolver extends SpecializedIntraNodeSolverAdapter {
  static override solverKind = "through-obstacle"
  static override diagnosticFields = [
    "nodeWithPortPoints",
    "routes",
    "obstacles",
    "viaDiameter",
    "traceThickness",
    "connMap",
    "solvedRoutes",
  ]
  override getSolverName(): string {
    return "SingleTransitionThroughObstacleIntraNodeSolver"
  }
  declare nodeWithPortPoints: NodeWithPortPoints
  declare routes: Route[]
  declare obstacles: LayeredObstacle[]
  declare viaDiameter: number
  declare traceThickness: number
  declare connMap?: ConnectivityMap
  declare solvedRoutes: HighDensityIntraNodeRoute[]
  constructor(props: {
    nodeWithPortPoints: NodeWithPortPoints
    obstacles?: Obstacle[]
    connMap?: ConnectivityMap
    layerCount?: number
    viaDiameter?: number
    traceThickness?: number
  }) {
    super(props)
  }
  static isApplicable(params: {
    nodeWithPortPoints: NodeWithPortPoints
    obstacles?: Obstacle[]
    connMap?: ConnectivityMap
    layerCount?: number
  }): boolean {
    return this.applicable(
      this.specializedBindings.isThroughObstacleApplicable,
      params,
    )
  }
}
