import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

const MAX_FORCE_IMPROVE_POINTS_PER_REGION = 4_096

export type BoundedHighDensityForceImproveSolverParams = {
  nodeWithPortPoints: NodeWithPortPoints[]
  hdRoutes: HighDensityRoute[]
  totalStepsPerNode?: number
  nodeAssignmentMargin?: number
  colorMap?: Record<string, string>
  protectOverBudgetRegions?: boolean
}

/**
 * Keeps prevalidated layer transitions fixed and bounds the quadratic force
 * stage after collinear grid-route simplification has done all it safely can.
 */
export class BoundedHighDensityForceImproveSolver extends HighDensityForceImproveSolver {
  private readonly allHdRoutes: HighDensityRoute[]
  private readonly allNodeWithPortPoints: NodeWithPortPoints[]
  private readonly protectedRouteIndexes: Set<number>
  private readonly protectedLayerTransitionRouteCount: number
  private readonly protectedOverBudgetRouteCount: number
  private readonly protectOverBudgetRegions: boolean

  constructor(params: BoundedHighDensityForceImproveSolverParams) {
    const transitionNodeIds = new Set(
      params.nodeWithPortPoints
        .filter((node) => node.isLayerTransition)
        .map((node) => node.capacityMeshNodeId),
    )
    const pointCountByRegionId = new Map<string, number>()
    for (const route of params.hdRoutes) {
      if (!route.regionId) continue
      pointCountByRegionId.set(
        route.regionId,
        (pointCountByRegionId.get(route.regionId) ?? 0) + route.route.length,
      )
    }
    const protectOverBudgetRegions = params.protectOverBudgetRegions ?? true
    const overBudgetRegionIds = protectOverBudgetRegions
      ? new Set(
          [...pointCountByRegionId]
            .filter(
              ([, pointCount]) =>
                pointCount > MAX_FORCE_IMPROVE_POINTS_PER_REGION,
            )
            .map(([regionId]) => regionId),
        )
      : new Set<string>()
    const protectedRouteIndexes = new Set<number>()
    let protectedLayerTransitionRouteCount = 0
    let protectedOverBudgetRouteCount = 0
    const movableRoutes = params.hdRoutes.filter((route, index) => {
      const isLayerTransition =
        route.regionId !== undefined && transitionNodeIds.has(route.regionId)
      const isOverBudget =
        route.regionId !== undefined && overBudgetRegionIds.has(route.regionId)
      if (isLayerTransition) protectedLayerTransitionRouteCount++
      if (isOverBudget) protectedOverBudgetRouteCount++
      if (isLayerTransition || isOverBudget) protectedRouteIndexes.add(index)
      return !isLayerTransition && !isOverBudget
    })
    const protectedRegionIds = new Set([
      ...transitionNodeIds,
      ...overBudgetRegionIds,
    ])

    super({
      ...params,
      nodeWithPortPoints: params.nodeWithPortPoints.filter(
        (node) => !protectedRegionIds.has(node.capacityMeshNodeId),
      ),
      hdRoutes: movableRoutes,
    })
    this.allHdRoutes = params.hdRoutes
    this.allNodeWithPortPoints = params.nodeWithPortPoints
    this.protectedRouteIndexes = protectedRouteIndexes
    this.protectedLayerTransitionRouteCount = protectedLayerTransitionRouteCount
    this.protectedOverBudgetRouteCount = protectedOverBudgetRouteCount
    this.protectOverBudgetRegions = protectOverBudgetRegions
    this.updateProtectionStats()
  }

  private updateProtectionStats(): void {
    this.stats.protectedLayerTransitionRouteCount =
      this.protectedLayerTransitionRouteCount
    this.stats.protectedOverBudgetRouteCount =
      this.protectedOverBudgetRouteCount
  }

  override _step(): void {
    super._step()
    this.updateProtectionStats()
  }

  override getOutput(): HighDensityRoute[] {
    const improvedMovableRoutes = super.getOutput()
    let movableRouteIndex = 0

    return this.allHdRoutes.map((route, routeIndex) => {
      if (this.protectedRouteIndexes.has(routeIndex)) return route
      return improvedMovableRoutes[movableRouteIndex++]!
    })
  }

  override getConstructorParams() {
    return [
      {
        nodeWithPortPoints: this.allNodeWithPortPoints,
        hdRoutes: this.allHdRoutes,
        totalStepsPerNode: this.totalStepsPerNode,
        nodeAssignmentMargin: this.nodeAssignmentMargin,
        colorMap: this.colorMap,
        protectOverBudgetRegions: this.protectOverBudgetRegions,
      },
    ] as const
  }
}
