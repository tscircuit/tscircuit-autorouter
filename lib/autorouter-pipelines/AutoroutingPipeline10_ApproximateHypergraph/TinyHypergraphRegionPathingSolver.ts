import {
  loadSerializedHyperGraph,
  RegionPathSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"
import { doSegmentsIntersect } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type {
  ConnectionHgWithNetId,
  HgPortPointPathingSolverParams,
  RegionHg,
  RegionPortHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { buildSerializedTinyGraphForRegionPathing } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import { type ConnectionPoint, getConnectionPointLayers } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export interface TinyHypergraphRegionPathingSolverParams
  extends HgPortPointPathingSolverParams {
  approximateLayerChangeCost?: number
  approximateRegionCapacityCost?: number
}

type BoundaryPortChoice = {
  port: RegionPortHg
  cost: number
  previousIndex: number
}

type MaterializedOutput = {
  nodesWithPortPoints: NodeWithPortPoints[]
  inputNodeWithPortPoints: InputNodeWithPortPoints[]
}

const DEFAULT_LAYER_CHANGE_COST = 4
const DEFAULT_REGION_CAPACITY_COST = 20

class ApproximateCapacityRegionPathSolver extends RegionPathSolver {
  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    private readonly routingPitch: number,
    regionCapacityCost: number,
  ) {
    super(topology, problem, {
      MM_COST_FOR_FULL_REGION: regionCapacityCost,
    })
  }

  override computeRegionEntryCost(regionId: number): number {
    const metadata = this.topology.regionMetadata?.[regionId]
    if (metadata?._tinyTerminal) return 0

    const narrowDimension = Math.min(
      this.regionGraph.regionWidth[regionId],
      this.regionGraph.regionHeight[regionId],
    )
    const approximateTraceCapacity = Math.max(
      1,
      Math.floor(narrowDimension / this.routingPitch),
    )
    const nextUsage = this.state.regionUsage[regionId] + 1
    const utilization = nextUsage / approximateTraceCapacity

    return 1 + utilization ** 4 * this.MM_COST_FOR_FULL_REGION
  }
}

const getRegionPairKey = (regionIdA: string, regionIdB: string) =>
  regionIdA < regionIdB
    ? `${regionIdA}\u0000${regionIdB}`
    : `${regionIdB}\u0000${regionIdA}`

const pointToLineSegmentDistance = (
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        lengthSquared,
    ),
  )
  return Math.hypot(
    point.x - (start.x + t * dx),
    point.y - (start.y + t * dy),
  )
}

const getConnectionPointZ = (params: {
  point: ConnectionPoint
  region: RegionHg
  layerCount: number
}) => {
  const pointZ = getConnectionPointLayers(params.point).map((layerName) =>
    mapLayerNameToZ(layerName, params.layerCount),
  )
  return params.region.d.availableZ.find((z) => pointZ.includes(z)) ??
    params.region.d.availableZ[0] ??
    0
}

const getConnectionOrThrow = (
  connection: ConnectionHgWithNetId,
) => {
  if (!connection.simpleRouteConnection) {
    throw new Error(
      `TinyHypergraphRegionPathingSolver requires a SimpleRouteConnection for "${connection.connectionId}"`,
    )
  }
  return connection.simpleRouteConnection
}

const buildInputNodesWithPortPoints = (
  params: HgPortPointPathingSolverParams,
): InputNodeWithPortPoints[] =>
  params.graph.regions.map((region) => ({
    capacityMeshNodeId: region.d.capacityMeshNodeId,
    center: region.d.center,
    width: region.d.width,
    height: region.d.height,
    portPoints: region.ports.map((port) => {
      const portPointChain = port.d as typeof port.d & {
        prevPortPointId?: string
        nextPortPointId?: string
      }
      return {
        portPointId: port.d.portId,
        x: port.d.x,
        y: port.d.y,
        z: port.d.z,
        prevPortPointId: portPointChain.prevPortPointId,
        nextPortPointId: portPointChain.nextPortPointId,
        connectionNodeIds: [
          port.region1.regionId,
          port.region2.regionId,
        ],
        distToCentermostPortOnZ: port.d.distToCentermostPortOnZ,
        cramped: port.d.cramped,
        connectsToOffBoardNode: Boolean(
          port.region1.d._offBoardConnectionId ??
            port.region2.d._offBoardConnectionId,
        ),
      } satisfies InputPortPoint
    }),
    availableZ: region.d.availableZ,
    _containsObstacle: region.d._containsObstacle,
    _containsTarget: region.d._containsTarget,
    _offBoardConnectionId: region.d._offBoardConnectionId,
    _offBoardConnectedCapacityMeshNodeIds:
      region.d._offBoardConnectedCapacityMeshNodeIds,
    _qfpRegionType: region.d._qfpRegionType,
    _isNarrowQfpPadGap: region.d._isNarrowQfpPadGap,
  }))

export class TinyHypergraphRegionPathingSolver extends BaseSolver {
  private readonly regionPathSolver: RegionPathSolver
  private readonly regionById: Map<string, RegionHg>
  private readonly connectionById: Map<string, ConnectionHgWithNetId>
  private readonly portsByRegionPair = new Map<string, RegionPortHg[]>()
  private readonly assignedPortUsage = new Map<string, number>()
  private output?: MaterializedOutput

  constructor(
    private readonly params: TinyHypergraphRegionPathingSolverParams,
  ) {
    super()
    const serializedGraph = buildSerializedTinyGraphForRegionPathing(params)
    const { topology, problem } = loadSerializedHyperGraph(serializedGraph)
    this.regionPathSolver = new ApproximateCapacityRegionPathSolver(
      topology,
      problem,
      Math.max(params.minViaPadDiameter ?? 0.6, 0.2),
      params.approximateRegionCapacityCost ?? DEFAULT_REGION_CAPACITY_COST,
    )
    this.regionById = new Map(
      params.graph.regions.map((region) => [region.regionId, region]),
    )
    this.connectionById = new Map(
      params.connections.map((connection) => [
        connection.connectionId,
        connection,
      ]),
    )
    for (const port of params.graph.ports) {
      const key = getRegionPairKey(
        port.region1.regionId,
        port.region2.regionId,
      )
      const ports = this.portsByRegionPair.get(key) ?? []
      ports.push(port)
      this.portsByRegionPair.set(key, ports)
    }
    this.MAX_ITERATIONS = 1
  }

  override getSolverName(): string {
    return "TinyHypergraphRegionPathingSolver"
  }

  override getConstructorParams(): [TinyHypergraphRegionPathingSolverParams] {
    return [this.params]
  }

  override _step(): void {
    const solveStartedAt = performance.now()
    this.regionPathSolver.solve()
    const solveTimeMs = performance.now() - solveStartedAt
    if (this.regionPathSolver.failed) {
      this.failed = true
      this.error = this.regionPathSolver.error
      return
    }

    const materializeStartedAt = performance.now()
    this.output = this.materializeOutput()
    const materializeTimeMs = performance.now() - materializeStartedAt
    this.stats = {
      ...this.regionPathSolver.stats,
      mode: "region-path",
      solveTimeMs,
      materializeTimeMs,
      outputNodeCount: this.output.nodesWithPortPoints.length,
      outputPairCount: this.output.nodesWithPortPoints.reduce(
        (sum, node) => sum + (node.portPointsInPairs?.length ?? 0),
        0,
      ),
    }
    this.solved = true
  }

  private materializeOutput(): MaterializedOutput {
    const pairsByRegionId = new Map<string, [PortPoint, PortPoint][]>()
    for (const solvedRoute of this.regionPathSolver.getOutput().solvedRoutes) {
      if (!solvedRoute.connectionId) {
        throw new Error(
          `TinyHypergraphRegionPathingSolver route ${solvedRoute.routeId} is missing a connection ID`,
        )
      }
      const connection = this.connectionById.get(solvedRoute.connectionId)
      if (!connection) {
        throw new Error(
          `TinyHypergraphRegionPathingSolver could not find connection "${solvedRoute.connectionId}"`,
        )
      }
      this.materializeConnectionRoute({
        connection,
        regionIds: solvedRoute.regionIds.filter((regionId) =>
          this.regionById.has(regionId),
        ),
        pairsByRegionId,
      })
    }

    const nodesWithPortPoints: NodeWithPortPoints[] = []
    for (const [regionId, portPointsInPairs] of pairsByRegionId) {
      const region = this.regionById.get(regionId)
      if (!region || portPointsInPairs.length === 0) continue
      nodesWithPortPoints.push({
        capacityMeshNodeId: region.d.capacityMeshNodeId,
        center: region.d.center,
        width: region.d.width,
        height: region.d.height,
        portPoints: portPointsInPairs.flat(),
        portPointsInPairs,
        availableZ: region.d.availableZ,
        _isComponentTopologyNode: region.d._isComponentTopologyNode,
      })
    }

    return {
      nodesWithPortPoints,
      inputNodeWithPortPoints: buildInputNodesWithPortPoints(this.params),
    }
  }

  private materializeConnectionRoute(params: {
    connection: ConnectionHgWithNetId
    regionIds: string[]
    pairsByRegionId: Map<string, [PortPoint, PortPoint][]>
  }): void {
    const { connection } = params
    const simpleRouteConnection = getConnectionOrThrow(connection)
    const regionIds = params.regionIds
    if (regionIds.length === 0) {
      throw new Error(
        `TinyHypergraphRegionPathingSolver returned an empty path for "${connection.connectionId}"`,
      )
    }
    const [startPoint, endPoint] = simpleRouteConnection.pointsToConnect
    const startZ = getConnectionPointZ({
      point: startPoint,
      region: connection.startRegion,
      layerCount: this.params.layerCount,
    })
    const endZ = getConnectionPointZ({
      point: endPoint,
      region: connection.endRegion,
      layerCount: this.params.layerCount,
    })
    const boundaryPorts = this.chooseBoundaryPorts({
      connection,
      regionIds,
      startZ,
      endZ,
      pairsByRegionId: params.pairsByRegionId,
    })
    for (const port of boundaryPorts) {
      this.assignedPortUsage.set(
        port.d.portId,
        (this.assignedPortUsage.get(port.d.portId) ?? 0) + 1,
      )
    }
    const connectionName = simpleRouteConnection.name
    const rootConnectionName =
      simpleRouteConnection.__rootConnectionNames?.[0]

    for (let regionIndex = 0; regionIndex < regionIds.length; regionIndex++) {
      const regionId = regionIds[regionIndex]!
      const fromPoint =
        regionIndex === 0
          ? this.createTerminalPortPoint({
              connection,
              endpoint: "start",
              point: startPoint,
              z: startZ,
            })
          : this.createBoundaryPortPoint(
              boundaryPorts[regionIndex - 1]!,
              connectionName,
              rootConnectionName,
            )
      const toPoint =
        regionIndex === regionIds.length - 1
          ? this.createTerminalPortPoint({
              connection,
              endpoint: "end",
              point: endPoint,
              z: endZ,
            })
          : this.createBoundaryPortPoint(
              boundaryPorts[regionIndex]!,
              connectionName,
              rootConnectionName,
            )

      if (fromPoint.portPointId && toPoint.portPointId) {
        fromPoint.nextPortPointId = toPoint.portPointId
        toPoint.prevPortPointId = fromPoint.portPointId
      }
      const pairs = params.pairsByRegionId.get(regionId) ?? []
      pairs.push([fromPoint, toPoint])
      params.pairsByRegionId.set(regionId, pairs)
    }
  }

  private chooseBoundaryPorts(params: {
    connection: ConnectionHgWithNetId
    regionIds: string[]
    startZ: number
    endZ: number
    pairsByRegionId: Map<string, [PortPoint, PortPoint][]>
  }): RegionPortHg[] {
    const boundaryCandidates: RegionPortHg[][] = []
    for (let index = 1; index < params.regionIds.length; index++) {
      const previousRegionId = params.regionIds[index - 1]!
      const nextRegionId = params.regionIds[index]!
      const candidates = this.portsByRegionPair.get(
        getRegionPairKey(previousRegionId, nextRegionId),
      )
      if (!candidates || candidates.length === 0) {
        throw new Error(
          `TinyHypergraphRegionPathingSolver found no boundary port between "${previousRegionId}" and "${nextRegionId}"`,
        )
      }
      boundaryCandidates.push(candidates)
    }
    if (boundaryCandidates.length === 0) return []

    const simpleRouteConnection = getConnectionOrThrow(params.connection)
    const [startPoint, endPoint] = simpleRouteConnection.pointsToConnect
    const layerChangeCost =
      this.params.approximateLayerChangeCost ?? DEFAULT_LAYER_CHANGE_COST
    const choiceLayers: BoundaryPortChoice[][] = []

    for (
      let boundaryIndex = 0;
      boundaryIndex < boundaryCandidates.length;
      boundaryIndex++
    ) {
      const candidates = boundaryCandidates[boundaryIndex]!
      const previousChoices = choiceLayers[boundaryIndex - 1]
      const choices = candidates.map((port) => {
        const portPreferenceCost =
          pointToLineSegmentDistance(port.d, startPoint, endPoint) +
          port.d.distToCentermostPortOnZ * 0.05 +
          (port.d.cramped ? 1 : 0) +
          (port.d.tinyHypergraphPortPenalty ?? 0) +
          (this.assignedPortUsage.get(port.d.portId) ?? 0) * 10
        if (!previousChoices) {
          return {
            port,
            cost:
              portPreferenceCost +
              (port.d.z === params.startZ ? 0 : layerChangeCost) +
              this.getExistingCrossingPenalty({
                regionId: params.regionIds[0]!,
                start: { ...startPoint, z: params.startZ },
                end: port.d,
                rootConnectionName:
                  simpleRouteConnection.__rootConnectionNames?.[0],
                pairsByRegionId: params.pairsByRegionId,
              }),
            previousIndex: -1,
          }
        }

        let bestPreviousIndex = 0
        let bestCost = Number.POSITIVE_INFINITY
        for (
          let previousIndex = 0;
          previousIndex < previousChoices.length;
          previousIndex++
        ) {
          const previousChoice = previousChoices[previousIndex]!
          const cost =
            previousChoice.cost +
            portPreferenceCost +
            (previousChoice.port.d.z === port.d.z ? 0 : layerChangeCost) +
            this.getExistingCrossingPenalty({
              regionId: params.regionIds[boundaryIndex]!,
              start: previousChoice.port.d,
              end: port.d,
              rootConnectionName:
                simpleRouteConnection.__rootConnectionNames?.[0],
              pairsByRegionId: params.pairsByRegionId,
            })
          if (cost < bestCost) {
            bestCost = cost
            bestPreviousIndex = previousIndex
          }
        }
        return { port, cost: bestCost, previousIndex: bestPreviousIndex }
      })
      choiceLayers.push(choices)
    }

    const lastChoices = choiceLayers[choiceLayers.length - 1]!
    let selectedIndex = 0
    let selectedCost = Number.POSITIVE_INFINITY
    for (let index = 0; index < lastChoices.length; index++) {
      const choice = lastChoices[index]!
      const cost =
        choice.cost +
        (choice.port.d.z === params.endZ ? 0 : layerChangeCost) +
        this.getExistingCrossingPenalty({
          regionId: params.regionIds[params.regionIds.length - 1]!,
          start: choice.port.d,
          end: { ...endPoint, z: params.endZ },
          rootConnectionName:
            simpleRouteConnection.__rootConnectionNames?.[0],
          pairsByRegionId: params.pairsByRegionId,
        })
      if (cost < selectedCost) {
        selectedCost = cost
        selectedIndex = index
      }
    }

    const selectedPorts = new Array<RegionPortHg>(choiceLayers.length)
    for (
      let boundaryIndex = choiceLayers.length - 1;
      boundaryIndex >= 0;
      boundaryIndex--
    ) {
      const selectedChoice = choiceLayers[boundaryIndex]![selectedIndex]!
      selectedPorts[boundaryIndex] = selectedChoice.port
      selectedIndex = selectedChoice.previousIndex
    }
    return selectedPorts
  }

  private getExistingCrossingPenalty(params: {
    regionId: string
    start: { x: number; y: number; z: number }
    end: { x: number; y: number; z: number }
    rootConnectionName?: string
    pairsByRegionId: Map<string, [PortPoint, PortPoint][]>
  }): number {
    let penalty = 0
    for (const [existingStart, existingEnd] of
      params.pairsByRegionId.get(params.regionId) ?? []) {
      const existingRoot =
        existingStart.rootConnectionName ?? existingStart.connectionName
      if (
        params.rootConnectionName &&
        existingRoot === params.rootConnectionName
      ) {
        continue
      }
      if (
        !doSegmentsIntersect(
          params.start,
          params.end,
          existingStart,
          existingEnd,
        )
      ) {
        continue
      }
      const candidateChangesLayer = params.start.z !== params.end.z
      const existingChangesLayer = existingStart.z !== existingEnd.z
      if (
        !candidateChangesLayer &&
        !existingChangesLayer &&
        params.start.z !== existingStart.z
      ) {
        continue
      }
      penalty += candidateChangesLayer || existingChangesLayer ? 25 : 100
    }
    return penalty
  }

  private createTerminalPortPoint(params: {
    connection: ConnectionHgWithNetId
    endpoint: "start" | "end"
    point: { x: number; y: number; pcb_port_id?: string }
    z: number
  }): PortPoint {
    const simpleRouteConnection = getConnectionOrThrow(params.connection)
    return {
      portPointId: `tiny-terminal:${params.endpoint}-port:${params.connection.connectionId}`,
      x: params.point.x,
      y: params.point.y,
      z: params.z,
      connectionName: simpleRouteConnection.name,
      rootConnectionName: simpleRouteConnection.__rootConnectionNames?.[0],
      ...(this.params.preserveTerminalPcbPortIds && params.point.pcb_port_id
        ? { pcb_port_id: params.point.pcb_port_id }
        : {}),
    }
  }

  private createBoundaryPortPoint(
    port: RegionPortHg,
    connectionName: string,
    rootConnectionName?: string,
  ): PortPoint {
    const chain = port.d as typeof port.d & {
      prevPortPointId?: string
      nextPortPointId?: string
    }
    return {
      portPointId: port.d.portId,
      x: port.d.x,
      y: port.d.y,
      z: port.d.z,
      connectionName,
      rootConnectionName,
      prevPortPointId: chain.prevPortPointId,
      nextPortPointId: chain.nextPortPointId,
    }
  }

  getOutput(): MaterializedOutput {
    if (!this.output) {
      throw new Error(
        "TinyHypergraphRegionPathingSolver output requested before solve",
      )
    }
    return this.output
  }

  computeNodePf(node: InputNodeWithPortPoints): number | null {
    const solvedNode = this.output?.nodesWithPortPoints.find(
      (candidate) => candidate.capacityMeshNodeId === node.capacityMeshNodeId,
    )
    const originalRegion = this.regionById.get(node.capacityMeshNodeId)
    if (!solvedNode || !originalRegion) return null
    const crossings = getIntraNodeCrossingsUsingCircle(solvedNode)
    return calculateNodeProbabilityOfFailure(
      originalRegion.d,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )
  }

  override visualize(): GraphicsObject {
    return this.regionPathSolver.visualize()
  }
}
