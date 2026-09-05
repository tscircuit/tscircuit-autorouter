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
}): HighDensityRoute[] | null => {
  const candidatesByConnectionName = new Map<string, HighDensityRoute[]>()
  for (const candidateRoute of candidateRoutes) {
    const routes =
      candidatesByConnectionName.get(candidateRoute.connectionName) ?? []
    routes.push(candidateRoute)
    candidatesByConnectionName.set(candidateRoute.connectionName, routes)
  }

  const replacedRoutes: HighDensityRoute[] = []
  for (const currentRoute of currentRoutes) {
    if (currentRoute.regionId !== nodeId) {
      replacedRoutes.push(currentRoute)
      continue
    }
    const candidates = candidatesByConnectionName.get(
      currentRoute.connectionName,
    )
    const candidate = candidates?.shift()
    if (!candidate) return null
    replacedRoutes.push({
      ...candidate,
      rootConnectionName: currentRoute.rootConnectionName,
      regionId: nodeId,
    })
  }

  // A node can include preloaded pseudo-connections that this stage does not
  // own. Reject a candidate that rerouted them because projecting only part of
  // that solution would change the geometry the other routes were solved
  // against and can regress the later global repair stages.
  if (
    [...candidatesByConnectionName.values()].some((routes) => routes.length > 0)
  ) {
    return null
  }
  return replacedRoutes
}

/**
 * Repairs Pipeline9 DRCs while the route fragments still retain their
 * high-density node boundaries. A node that participates in every repairable
 * DRC is routed again with the ordinary high-density search, and its candidate
 * is published only when it clears the repairable DRC set.
 */
export class Pipeline9HighDensityDrcRepairSolver extends BaseSolver {
  readonly params: Pipeline9HighDensityDrcRepairSolverParams
  readonly attemptedNodeIds = new Set<string>()
  outputHdRoutes: HighDensityRoute[]
  currentErrors: Pipeline9DrcError[]
  activeNode: NodeWithPortPoints | null = null
  override activeSubSolver: HighDensitySolver | null = null
  private acceptedCandidate: AcceptedHighDensityCandidate | null = null

  constructor(params: Pipeline9HighDensityDrcRepairSolverParams) {
    super()
    this.params = params
    this.outputHdRoutes = clonePipeline9HdRoutes(params.hdRoutes)
    this.currentErrors = this.getRepairableDrcErrors(this.outputHdRoutes)
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

  private getRouteIndexByTraceId(
    routes: HighDensityRoute[],
  ): Map<string, number> {
    return getPipeline9RouteIndexByTraceId({
      routes,
      newConnections: this.params.newConnections,
      syntheticConnectionNames: new Set<string>(),
    })
  }

  private getRepairableDrcErrors(
    routes: HighDensityRoute[],
  ): Pipeline9DrcError[] {
    const routeIndexByTraceId = this.getRouteIndexByTraceId(routes)
    return getPipeline9DrcErrors(this.params.drcEvaluator, routes).filter(
      (error) =>
        getPipeline9DrcErrorTraceIds(error).some((traceId) =>
          routeIndexByTraceId.has(traceId),
        ),
    )
  }

  private getCurrentDrcNodeIds(): Set<string> {
    const routeIndexByTraceId = this.getRouteIndexByTraceId(this.outputHdRoutes)
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

  private getAtomicCandidateNodeIds(): Set<string> {
    const routeIndexByTraceId = this.getRouteIndexByTraceId(this.outputHdRoutes)
    let candidateNodeIds: Set<string> | null = null
    for (const error of this.currentErrors) {
      const errorNodeIds = new Set<string>()
      for (const traceId of getPipeline9DrcErrorTraceIds(error)) {
        const routeIndex = routeIndexByTraceId.get(traceId)
        if (routeIndex === undefined) continue
        const regionId = this.outputHdRoutes[routeIndex]!.regionId
        if (regionId !== undefined) errorNodeIds.add(regionId)
      }
      if (candidateNodeIds === null) {
        candidateNodeIds = errorNodeIds
        continue
      }
      for (const nodeId of candidateNodeIds) {
        if (!errorNodeIds.has(nodeId)) candidateNodeIds.delete(nodeId)
      }
    }
    return candidateNodeIds ?? new Set<string>()
  }

  private getNextAffectedNode(): NodeWithPortPoints | undefined {
    const currentDrcNodeIds = this.getCurrentDrcNodeIds()
    const candidateNodeIds = this.getAtomicCandidateNodeIds()
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
        candidateNodeIds.has(node.capacityMeshNodeId) &&
        !this.attemptedNodeIds.has(node.capacityMeshNodeId),
    )
  }

  private evaluateCandidateRoutes(
    candidateNodeRoutes: HighDensityRoute[],
    nodeId: string,
  ): boolean {
    this.stats.candidateAttemptCount =
      Number(this.stats.candidateAttemptCount ?? 0) + 1
    const candidateRoutes = replaceNodeRoutes({
      currentRoutes: this.outputHdRoutes,
      candidateRoutes: candidateNodeRoutes,
      nodeId,
    })
    if (!candidateRoutes) return false
    const candidateErrors = this.getRepairableDrcErrors(candidateRoutes)
    if (
      candidateErrors.length > 0 ||
      !isPipeline9DrcCandidateBetter(candidateErrors, this.currentErrors)
    ) {
      return false
    }
    this.acceptedCandidate = {
      routes: candidateRoutes,
      errors: candidateErrors,
    }
    return true
  }

  private getUnownedNodeConnectionName(
    node: NodeWithPortPoints,
  ): string | undefined {
    const ownedConnectionNames = new Set(
      this.outputHdRoutes
        .filter((route) => route.regionId === node.capacityMeshNodeId)
        .map((route) => route.connectionName),
    )
    return node.portPoints.find(
      (portPoint) => !ownedConnectionNames.has(portPoint.connectionName),
    )?.connectionName
  }

  private startNodeRepair(node: NodeWithPortPoints): void {
    this.activeNode = node
    this.acceptedCandidate = null
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
      useGrowShrinkHighDensityIntraNodeSolver: false,
      preserveTerminalPcbPortIds: true,
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

  private finishExhaustedNodeRepair(error: string): void {
    this.stats.exhaustedNodeCount =
      Number(this.stats.exhaustedNodeCount ?? 0) + 1
    this.stats.lastExhaustedNodeError = error
    this.activeSubSolver = null
    this.activeNode = null
    this.acceptedCandidate = null
  }

  private finishRepairPass(): void {
    this.activeSubSolver = null
    this.activeNode = null
    this.acceptedCandidate = null
    this.stats.finalDrcIssueCount = this.currentErrors.length
    this.solved = true
  }

  override _step(): void {
    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      if (this.activeSubSolver.solved) {
        if (!this.activeNode) {
          throw new Error(
            "Pipeline9 high-density DRC repair solved without an active node",
          )
        }
        const nodeId = this.activeNode.capacityMeshNodeId
        if (this.evaluateCandidateRoutes(this.activeSubSolver.routes, nodeId)) {
          this.finishAcceptedNodeRepair()
          return
        }
        this.finishExhaustedNodeRepair(
          `Ordinary high-density reroute did not improve DRCs for node "${nodeId}"`,
        )
        return
      }
      if (!this.activeSubSolver.failed) return
      // Like Repair03, this is best-effort optimization: an ordinary
      // high-density reroute can be unavailable even though the incumbent is
      // a complete route. Keep that incumbent and try another affected node.
      this.finishExhaustedNodeRepair(
        this.activeSubSolver.error ??
          `Ordinary high-density reroute failed for node "${this.activeNode?.capacityMeshNodeId}"`,
      )
      return
    }

    if (
      ![...this.getAtomicCandidateNodeIds()].some(
        (nodeId) => !this.attemptedNodeIds.has(nodeId),
      )
    ) {
      this.finishRepairPass()
      return
    }

    const nextNode = this.getNextAffectedNode()
    if (nextNode) {
      const unownedConnectionName = this.getUnownedNodeConnectionName(nextNode)
      if (unownedConnectionName) {
        this.attemptedNodeIds.add(nextNode.capacityMeshNodeId)
        this.stats.attemptedNodeCount = this.attemptedNodeIds.size
        // The ordinary solver routes every connection represented by the
        // node. A fixed/preloaded pseudo-connection would therefore make the
        // candidate fail the exact route-ownership check after doing all of
        // the search work, so reject that impossible candidate up front.
        this.finishExhaustedNodeRepair(
          `Node "${nextNode.capacityMeshNodeId}" includes unowned connection "${unownedConnectionName}"`,
        )
        return
      }
      this.startNodeRepair(nextNode)
      return
    }
    this.finishRepairPass()
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
