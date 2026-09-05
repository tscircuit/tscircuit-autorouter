import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteConnection } from "lib/types/srj-types"
import { normalizePipeline9NodeRootConnectionNames } from "./Pipeline9HighDensitySolver"
import {
  clonePipeline9HdRoutes,
  getPipeline9DrcErrors,
  getPipeline9DrcErrorTraceIds,
  getPipeline9RouteIndexByTraceId,
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "./pipeline9JointDrcRepairUtils"

export type Pipeline9HighDensityDrcRepairSolverParams = {
  nodePortPoints: NodeWithPortPoints[]
  hdRoutes: HighDensityRoute[]
  newConnections: SimpleRouteConnection[]
  drcEvaluator: DrcEvaluator
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  obstacles: Obstacle[]
  layerCount: number
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
  nodePfById?:
    | Map<CapacityMeshNodeId, number | null>
    | Record<string, number | null>
}

type AcceptedHighDensityCandidate = {
  routes: HighDensityRoute[]
  errors: Pipeline9DrcError[]
}

const replaceNodeRoutes = ({
  currentRoutes,
  candidateRoutes,
  nodeId,
}: {
  currentRoutes: HighDensityRoute[]
  candidateRoutes: HighDensityRoute[]
  nodeId: string
}): HighDensityRoute[] => {
  const candidatesByConnectionName = new Map<string, HighDensityRoute[]>()
  for (const candidateRoute of candidateRoutes) {
    const routes =
      candidatesByConnectionName.get(candidateRoute.connectionName) ?? []
    routes.push(candidateRoute)
    candidatesByConnectionName.set(candidateRoute.connectionName, routes)
  }

  const replacedRoutes = currentRoutes.map((currentRoute) => {
    if (currentRoute.regionId !== nodeId) return currentRoute
    const candidates = candidatesByConnectionName.get(
      currentRoute.connectionName,
    )
    const candidate = candidates?.shift()
    if (!candidate) {
      throw new Error(
        `Pipeline9 high-density DRC repair lost route "${currentRoute.connectionName}" in node "${nodeId}"`,
      )
    }
    return {
      ...candidate,
      rootConnectionName: currentRoute.rootConnectionName,
      regionId: nodeId,
    }
  })

  const unusedCandidate = [...candidatesByConnectionName.values()].find(
    (routes) => routes.length > 0,
  )?.[0]
  if (unusedCandidate) {
    throw new Error(
      `Pipeline9 high-density DRC repair produced an extra route "${unusedCandidate.connectionName}" in node "${nodeId}"`,
    )
  }
  return replacedRoutes
}

/**
 * Repairs Pipeline9 DRCs while the route fragments still retain their
 * high-density node boundaries. Each affected node is routed again with the
 * ordinary high-density search, and a candidate is accepted only when the
 * board-level DRC objective improves.
 */
export class Pipeline9HighDensityDrcRepairSolver extends BaseSolver {
  readonly params: Pipeline9HighDensityDrcRepairSolverParams
  readonly attemptedNodeIds = new Set<string>()
  outputHdRoutes: HighDensityRoute[]
  currentErrors: Pipeline9DrcError[]
  activeNode: NodeWithPortPoints | null = null
  override activeSubSolver: HighDensitySolver | null = null
  private acceptedCandidate: AcceptedHighDensityCandidate | null = null
  private activeNodeCandidateAttemptCount = 0

  constructor(params: Pipeline9HighDensityDrcRepairSolverParams) {
    super()
    this.params = params
    this.outputHdRoutes = clonePipeline9HdRoutes(params.hdRoutes)
    this.currentErrors = getPipeline9DrcErrors(
      params.drcEvaluator,
      this.outputHdRoutes,
    )
    this.MAX_ITERATIONS =
      Math.max(1, params.nodePortPoints.length) * 100e6 * params.effort
    this.stats = {
      initialDrcIssueCount: this.currentErrors.length,
      finalDrcIssueCount: this.currentErrors.length,
      drcNodeCount: this.getCurrentDrcNodeIds().size,
      attemptedNodeCount: 0,
      acceptedNodeCount: 0,
      exhaustedNodeCount: 0,
      candidateAttemptCount: 0,
    }
    if (this.currentErrors.length === 0) this.solved = true
  }

  override getConstructorParams(): readonly [
    Pipeline9HighDensityDrcRepairSolverParams,
  ] {
    const constructorParams = this.params
    return [constructorParams] as const
  }

  private getCurrentDrcNodeIds(): Set<string> {
    const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
      routes: this.outputHdRoutes,
      newConnections: this.params.newConnections,
      syntheticConnectionNames: new Set<string>(),
    })
    const nodeIds = new Set<string>()
    for (const error of this.currentErrors) {
      for (const traceId of getPipeline9DrcErrorTraceIds(error)) {
        const routeIndex = routeIndexByTraceId.get(traceId)
        if (routeIndex === undefined) continue
        const route = this.outputHdRoutes[routeIndex]!
        if (!route.regionId) {
          throw new Error(
            `Pipeline9 high-density route "${route.connectionName}" has no regionId during DRC repair`,
          )
        }
        nodeIds.add(route.regionId)
      }
    }
    return nodeIds
  }

  private getNextAffectedNode(): NodeWithPortPoints | undefined {
    const currentDrcNodeIds = this.getCurrentDrcNodeIds()
    const knownNodeIds = new Set(
      this.params.nodePortPoints.map((node) => node.capacityMeshNodeId),
    )
    const missingNodeId = [...currentDrcNodeIds].find(
      (nodeId) => !knownNodeIds.has(nodeId),
    )
    if (missingNodeId) {
      throw new Error(
        `Pipeline9 cannot find high-density node "${missingNodeId}" selected for DRC repair`,
      )
    }
    return this.params.nodePortPoints.find(
      (node) =>
        currentDrcNodeIds.has(node.capacityMeshNodeId) &&
        !this.attemptedNodeIds.has(node.capacityMeshNodeId),
    )
  }

  private evaluateCandidateRoutes(
    candidateNodeRoutes: HighDensityRoute[],
    nodeId: string,
  ): boolean {
    this.activeNodeCandidateAttemptCount += 1
    this.stats.candidateAttemptCount =
      Number(this.stats.candidateAttemptCount ?? 0) + 1
    const candidateRoutes = replaceNodeRoutes({
      currentRoutes: this.outputHdRoutes,
      candidateRoutes: candidateNodeRoutes,
      nodeId,
    })
    const candidateErrors = getPipeline9DrcErrors(
      this.params.drcEvaluator,
      candidateRoutes,
    )
    if (!isPipeline9DrcCandidateBetter(candidateErrors, this.currentErrors)) {
      return false
    }
    this.acceptedCandidate = {
      routes: candidateRoutes,
      errors: candidateErrors,
    }
    return true
  }

  private startNodeRepair(node: NodeWithPortPoints): void {
    this.activeNode = node
    this.acceptedCandidate = null
    this.activeNodeCandidateAttemptCount = 0
    this.attemptedNodeIds.add(node.capacityMeshNodeId)
    this.stats.attemptedNodeCount = this.attemptedNodeIds.size
    this.activeSubSolver = new HighDensitySolver({
      nodePortPoints: [
        normalizePipeline9NodeRootConnectionNames(node, this.params.connMap),
      ],
      colorMap: this.params.colorMap,
      connMap: this.params.connMap,
      viaDiameter: this.params.viaDiameter,
      traceWidth: this.params.traceWidth,
      obstacleMargin: this.params.obstacleMargin,
      effort: this.params.effort,
      nodePfById: this.params.nodePfById,
      obstacles: this.params.obstacles,
      layerCount: this.params.layerCount,
      useGrowShrinkHighDensityIntraNodeSolver: true,
      preserveTerminalPcbPortIds: true,
      growShrinkFallbackToInvalidGeometryOnFailure: false,
      growShrinkSolutionValidator: (candidateRoutes): boolean =>
        this.evaluateCandidateRoutes(candidateRoutes, node.capacityMeshNodeId),
      captureSearchDebug: false,
    })
  }

  private finishAcceptedNodeRepair(): void {
    if (!this.acceptedCandidate || !this.activeNode) {
      throw new Error(
        "Pipeline9 high-density DRC repair solver finished without an accepted candidate",
      )
    }
    this.outputHdRoutes = this.acceptedCandidate.routes
    this.currentErrors = this.acceptedCandidate.errors
    this.stats.acceptedNodeCount = Number(this.stats.acceptedNodeCount ?? 0) + 1
    this.stats.finalDrcIssueCount = this.currentErrors.length
    this.acceptedCandidate = null
    this.activeNode = null
    this.activeSubSolver = null
  }

  override _step(): void {
    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      if (this.activeSubSolver.solved) {
        this.finishAcceptedNodeRepair()
        return
      }
      if (!this.activeSubSolver.failed) return
      if (this.activeNodeCandidateAttemptCount === 0) {
        throw new Error(
          `Pipeline9 could not reroute DRC node "${this.activeNode?.capacityMeshNodeId}": ${this.activeSubSolver.error}`,
        )
      }
      // Like Repair03, this is best-effort optimization: the child routed
      // candidates successfully, but the DRC validator rejected every one.
      // Keep the better incumbent and continue with another affected node.
      this.stats.exhaustedNodeCount =
        Number(this.stats.exhaustedNodeCount ?? 0) + 1
      this.stats.lastExhaustedNodeError = this.activeSubSolver.error
      this.activeSubSolver = null
      this.activeNode = null
      this.acceptedCandidate = null
      return
    }

    const nextNode = this.getNextAffectedNode()
    if (nextNode) {
      this.startNodeRepair(nextNode)
      return
    }
    this.stats.finalDrcIssueCount = this.currentErrors.length
    this.solved = true
  }

  getOutput(): HighDensityRoute[] {
    if (this.failed) {
      throw new Error(this.error ?? "Pipeline9 high-density DRC repair failed")
    }
    if (!this.solved) {
      throw new Error("Pipeline9 high-density DRC repair has not completed")
    }
    return this.outputHdRoutes
  }

  override visualize(): GraphicsObject {
    if (this.activeSubSolver) return this.activeSubSolver.visualize()
    return {
      title: "Pipeline9 High Density DRC Repair",
      lines: this.outputHdRoutes.flatMap((route) =>
        route.route.slice(0, -1).flatMap((point, pointIndex) => {
          const nextPoint = route.route[pointIndex + 1]!
          if (point.z !== nextPoint.z) return []
          return [
            {
              points: [point, nextPoint],
              strokeColor: this.params.colorMap[route.connectionName],
              strokeWidth: route.traceThickness,
              layer: `z${point.z}`,
              label: route.connectionName,
            },
          ]
        }),
      ),
    }
  }
}
