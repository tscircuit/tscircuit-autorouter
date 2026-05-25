import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import type { CapacityMeshNodeId, SimpleRouteJson } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import {
  type ConvexRegionsComputeResult,
  type LayerMergeMode,
  PORT_MARGIN_FROM_SEGMENT_ENDPOINT,
  PORT_SPACING,
  type SerializedPolyHyperGraph,
  applySerializedRegionNetIdsToLoadedProblem,
  buildPolyHyperGraphFromRegions,
  computeConvexRegions,
} from "pcb-poly-hyper-graph"
import {
  type PolyHyperGraphLoadResult,
  PolyHyperGraphSolver,
  type PolyHyperGraphSolverOptions,
  loadSerializedHyperGraphAsPoly,
} from "tiny-hypergraph-poly/lib/index"
import {
  getConnectedObstacleRegionsFromSrj,
  getPolyGraphConnectionsFromSrj,
  getPolyGraphPolygonsFromSrj,
  getPolyGraphRectsFromSrj,
} from "./srjToPolyHyperGraph"
import type { PolyNodeWithPortPoints } from "./types"

type RouteMetadata = {
  connectionId: string
  mutuallyConnectedNetworkId?: string
  simpleRouteConnection?: {
    name?: string
    rootConnectionName?: string
  }
}

export type PolyHypergraphPortPointPathingSolverOptions = {
  srj: SimpleRouteJson
  effort?: number
  concavityTolerance?: number
  layerMergeMode?: LayerMergeMode
  portSpacing?: number
  portMarginFromSegmentEndpoint?: number
  useConstrainedDelaunay?: boolean
  usePolyanyaMerge?: boolean
  viaSegments?: number
}

const getRouteConnectionName = (routeMetadata: RouteMetadata) =>
  routeMetadata.simpleRouteConnection?.name ?? routeMetadata.connectionId

const getRouteRootConnectionName = (routeMetadata: RouteMetadata) =>
  routeMetadata.simpleRouteConnection?.rootConnectionName ??
  routeMetadata.mutuallyConnectedNetworkId

const getSerializedRegionId = (metadata: unknown, fallbackRegionId: number) => {
  if (typeof metadata === "object" && metadata !== null) {
    const serializedRegionId = (metadata as { serializedRegionId?: unknown })
      .serializedRegionId
    if (typeof serializedRegionId === "string") return serializedRegionId
  }
  return `region-${fallbackRegionId}`
}

const getSerializedPortId = (metadata: unknown, fallbackPortId: number) => {
  if (typeof metadata === "object" && metadata !== null) {
    const serializedPortId = (metadata as { serializedPortId?: unknown })
      .serializedPortId
    if (typeof serializedPortId === "string") return serializedPortId
    const portId = (metadata as { portId?: unknown }).portId
    if (typeof portId === "string") return portId
  }
  return `poly-port-${fallbackPortId}`
}

const getPolygonFromMetadata = (metadata: unknown) => {
  if (typeof metadata !== "object" || metadata === null) return undefined
  const polygon = (metadata as { polygon?: unknown }).polygon
  if (!Array.isArray(polygon) || polygon.length < 3) return undefined
  if (
    polygon.every(
      (point) =>
        typeof point === "object" &&
        point !== null &&
        typeof (point as { x?: unknown }).x === "number" &&
        typeof (point as { y?: unknown }).y === "number",
    )
  ) {
    return polygon as Array<{ x: number; y: number }>
  }
  return undefined
}

export class PolyHypergraphPortPointPathingSolver extends BaseSolver {
  override getSolverName(): string {
    return "PolyHypergraphPortPointPathingSolver"
  }

  convexRegions: ConvexRegionsComputeResult
  serializedGraph: SerializedPolyHyperGraph
  loaded: PolyHyperGraphLoadResult
  polySolver: PolyHyperGraphSolver
  inputNodeWithPortPoints: InputNodeWithPortPoints[] = []
  nodesWithPortPoints: PolyNodeWithPortPoints[] = []
  reservedRegionCount = 0
  clearance: number
  effort: number
  usedUnconstrainedDelaunayFallback = false

  constructor(public params: PolyHypergraphPortPointPathingSolverOptions) {
    super()
    this.effort = params.effort ?? 1
    this.clearance =
      params.srj.defaultObstacleMargin ?? params.srj.minTraceWidth
    const computeRegions = (useConstrainedDelaunay: boolean) =>
      computeConvexRegions({
        bounds: params.srj.bounds,
        rects: getPolyGraphRectsFromSrj(params.srj),
        polygons: getPolyGraphPolygonsFromSrj(params.srj),
        clearance: this.clearance,
        concavityTolerance: params.concavityTolerance ?? 0,
        layerCount: params.srj.layerCount,
        layerMergeMode: params.layerMergeMode ?? "same",
        useConstrainedDelaunay,
        usePolyanyaMerge: params.usePolyanyaMerge ?? false,
        viaSegments: params.viaSegments ?? 8,
      })
    const useConstrainedDelaunay = params.useConstrainedDelaunay ?? true
    try {
      this.convexRegions = computeRegions(useConstrainedDelaunay)
    } catch (error) {
      if (!useConstrainedDelaunay) throw error
      this.usedUnconstrainedDelaunayFallback = true
      this.convexRegions = computeRegions(false)
    }
    this.serializedGraph = buildPolyHyperGraphFromRegions({
      regions: this.convexRegions.regions,
      availableZ: this.convexRegions.availableZ,
      layerCount: params.srj.layerCount,
      connections: getPolyGraphConnectionsFromSrj(params.srj),
      obstacleRegions: getConnectedObstacleRegionsFromSrj(
        params.srj,
        this.clearance,
      ),
      portSpacing: params.portSpacing ?? PORT_SPACING,
      portMarginFromSegmentEndpoint:
        params.portMarginFromSegmentEndpoint ??
        PORT_MARGIN_FROM_SEGMENT_ENDPOINT,
    })
    this.loaded = loadSerializedHyperGraphAsPoly(this.serializedGraph)
    this.reservedRegionCount = applySerializedRegionNetIdsToLoadedProblem(
      this.loaded,
      this.serializedGraph,
    )

    const solverOptions: PolyHyperGraphSolverOptions = {
      DISTANCE_TO_COST: 0.05,
      RIP_THRESHOLD_START: 0.05,
      RIP_THRESHOLD_END: 0.8,
      RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
      RIP_THRESHOLD_RAMP_ATTEMPTS: Math.max(1, Math.ceil(10 * this.effort)),
      MAX_ITERATIONS: Math.max(100_000, Math.ceil(10_000_000 * this.effort)),
    }
    this.polySolver = new PolyHyperGraphSolver(
      this.loaded.topology,
      this.loaded.problem,
      solverOptions,
    )
    this.activeSubSolver = this.polySolver as unknown as BaseSolver
    this.MAX_ITERATIONS = solverOptions.MAX_ITERATIONS! + 1_000
    this.inputNodeWithPortPoints = this.createInputNodesWithPortPoints()
  }

  private createInputNodesWithPortPoints(): InputNodeWithPortPoints[] {
    const { topology } = this.loaded
    const inputNodes: InputNodeWithPortPoints[] = []

    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const metadata = topology.regionMetadata?.[regionId] ?? {}
      const serializedRegionId = getSerializedRegionId(metadata, regionId)
      if (serializedRegionId.startsWith("terminal-")) continue

      const portPoints = (topology.regionIncidentPorts[regionId] ?? []).map(
        (portId) => {
          const candidateRegionIds = topology.incidentPortRegion[portId] ?? []
          return {
            portPointId: getSerializedPortId(
              topology.portMetadata?.[portId],
              portId,
            ),
            x: topology.portX[portId],
            y: topology.portY[portId],
            z: topology.portZ[portId],
            connectionNodeIds: candidateRegionIds.map((candidateRegionId) =>
              getSerializedRegionId(
                topology.regionMetadata?.[candidateRegionId],
                candidateRegionId,
              ),
            ) as [CapacityMeshNodeId, CapacityMeshNodeId],
            distToCentermostPortOnZ:
              topology.portMetadata?.[portId]?.distToCentermostPortOnZ ?? 0,
            connectsToOffBoardNode: false,
          } satisfies InputPortPoint
        },
      )

      inputNodes.push({
        capacityMeshNodeId: serializedRegionId,
        center: {
          x: topology.regionCenterX[regionId],
          y: topology.regionCenterY[regionId],
        },
        width: topology.regionWidth[regionId],
        height: topology.regionHeight[regionId],
        portPoints,
        availableZ:
          (metadata as { availableZ?: number[] }).availableZ ??
          Array.from({ length: this.params.srj.layerCount }, (_, z) => z),
        _containsObstacle: Boolean(metadata._containsObstacle),
        _containsTarget: Boolean(metadata._containsTarget),
      })
    }

    return inputNodes
  }

  private createAssignedPortPoint(routeId: number, portId: number): PortPoint {
    const routeMetadata = this.polySolver.problem.routeMetadata?.[routeId] as
      | RouteMetadata
      | undefined
    const connectionName = routeMetadata
      ? getRouteConnectionName(routeMetadata)
      : `route-${routeId}`
    const rootConnectionName = routeMetadata
      ? getRouteRootConnectionName(routeMetadata)
      : undefined

    return {
      portPointId: getSerializedPortId(
        this.polySolver.topology.portMetadata?.[portId],
        portId,
      ),
      x: this.polySolver.topology.portX[portId],
      y: this.polySolver.topology.portY[portId],
      z: this.polySolver.topology.portZ[portId],
      connectionName,
      rootConnectionName,
    }
  }

  private buildOutputNodes() {
    const { topology, state } = this.polySolver
    const outputNodes: PolyNodeWithPortPoints[] = []

    for (let regionId = 0; regionId < state.regionSegments.length; regionId++) {
      const metadata = topology.regionMetadata?.[regionId] ?? {}
      const serializedRegionId = getSerializedRegionId(metadata, regionId)
      if (serializedRegionId.startsWith("terminal-")) continue

      const polygon = getPolygonFromMetadata(metadata)
      if (!polygon) continue

      const portPoints = (state.regionSegments[regionId] ?? []).flatMap(
        ([routeId, fromPortId, toPortId]) =>
          [
            this.createAssignedPortPoint(routeId, fromPortId),
            this.createAssignedPortPoint(routeId, toPortId),
          ] satisfies PortPoint[],
      )

      if (portPoints.length === 0) continue

      outputNodes.push({
        capacityMeshNodeId: serializedRegionId,
        center: {
          x: topology.regionCenterX[regionId],
          y: topology.regionCenterY[regionId],
        },
        width: topology.regionWidth[regionId],
        height: topology.regionHeight[regionId],
        polygon,
        portPoints,
        availableZ: metadata.availableZ as number[] | undefined,
      })
    }

    this.nodesWithPortPoints = outputNodes
  }

  _step() {
    this.polySolver.step()
    this.progress = this.polySolver.progress
    this.stats = {
      ...(this.polySolver.stats ?? {}),
      reservedRegionCount: this.reservedRegionCount,
      usedUnconstrainedDelaunayFallback: this.usedUnconstrainedDelaunayFallback,
      regionCount: this.loaded.topology.regionCount,
      portCount: this.loaded.topology.portCount,
      routeCount: this.loaded.problem.routeCount,
    }

    if (this.polySolver.solved) {
      this.buildOutputNodes()
      this.solved = true
      this.activeSubSolver = null
    } else if (this.polySolver.failed) {
      this.error = this.polySolver.error
      this.failed = true
      this.activeSubSolver = null
    }
  }

  getOutput(): {
    nodesWithPortPoints: PolyNodeWithPortPoints[]
    inputNodeWithPortPoints: InputNodeWithPortPoints[]
  } {
    return {
      nodesWithPortPoints: this.nodesWithPortPoints,
      inputNodeWithPortPoints: this.inputNodeWithPortPoints,
    }
  }

  computeNodePf(node: InputNodeWithPortPoints): number | null {
    const solvedNode = this.nodesWithPortPoints.find(
      (candidate) => candidate.capacityMeshNodeId === node.capacityMeshNodeId,
    )
    if (!solvedNode) return null

    const crossings = getIntraNodeCrossingsUsingCircle(solvedNode)
    return calculateNodeProbabilityOfFailure(
      {
        center: solvedNode.center,
        width: solvedNode.width,
        height: solvedNode.height,
        availableZ: solvedNode.availableZ ?? [],
      } as any,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )
  }

  getConstructorParams() {
    return [this.params] as const
  }

  preview(): GraphicsObject {
    return this.visualize()
  }

  visualize(): GraphicsObject {
    return this.polySolver.visualize()
  }
}
