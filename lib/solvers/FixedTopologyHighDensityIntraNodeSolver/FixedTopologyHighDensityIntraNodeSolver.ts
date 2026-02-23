import {
  type XYConnection as HgXYConnection,
  type JPort,
  type JRegion,
  type ViaByNet,
  ViaGraphSolver,
  createViaGraphWithConnections,
  generateDefaultViaTopologyGrid,
} from "@tscircuit/hypergraph"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "../../types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { buildColorMapFromPortPoints } from "./buildColorMapFromPortPoints"

export type ViaRegion = {
  viaRegionId: string
  center: { x: number; y: number }
  diameter: number
  connectedTo: string[]
}

export type HighDensityIntraNodeRouteWithVias = {
  connectionName: string
  rootConnectionName?: string
  traceThickness: number
  route: Array<{ x: number; y: number; z: number }>
  viaRegions: ViaRegion[]
}

export interface FixedTopologyHighDensityIntraNodeSolverParams {
  nodeWithPortPoints: NodeWithPortPoints
  colorMap?: Record<string, string>
  traceWidth?: number
  connMap?: ConnectivityMap
}

/**
 * Routes intra-node traces using a fixed via-topology grid and the hypergraph
 * via solver.
 */
export class FixedTopologyHighDensityIntraNodeSolver extends BaseSolver {
  override getSolverName(): string {
    return "FixedTopologyHighDensityIntraNodeSolver"
  }

  constructorParams: FixedTopologyHighDensityIntraNodeSolverParams
  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  traceWidth: number
  connMap?: ConnectivityMap

  rootConnectionNameByConnectionId: Map<string, string | undefined> = new Map()
  lastActiveSubSolver: ViaGraphSolver | null = null

  solvedRoutes: HighDensityIntraNodeRouteWithVias[] = []
  vias: ViaRegion[] = []
  tiledViasByNet: ViaByNet = {}

  constructor(params: FixedTopologyHighDensityIntraNodeSolverParams) {
    super()
    this.constructorParams = params
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.colorMap = params.colorMap ?? {}
    this.traceWidth = params.traceWidth ?? 0.15
    this.connMap = params.connMap
    this.MAX_ITERATIONS = 1e6

    // Initialize colorMap if not provided
    if (Object.keys(this.colorMap).length === 0) {
      this.colorMap = buildColorMapFromPortPoints(this.nodeWithPortPoints)
    }
  }

  getConstructorParams(): FixedTopologyHighDensityIntraNodeSolverParams {
    return this.constructorParams
  }

  private _initializeGraph(): ViaGraphSolver | null {
    const node = this.nodeWithPortPoints
    const nodeBounds = getBoundsFromNodeWithPortPoints(node)

    // Build connections from port points
    const connectionMap = new Map<
      string,
      { points: PortPoint[]; rootConnectionName?: string }
    >()
    for (const pp of node.portPoints) {
      const existing = connectionMap.get(pp.connectionName)
      if (existing) {
        existing.points.push(pp)
      } else {
        connectionMap.set(pp.connectionName, {
          points: [pp],
          rootConnectionName: pp.rootConnectionName,
        })
      }
    }

    this.rootConnectionNameByConnectionId.clear()
    const inputConnections: HgXYConnection[] = []
    for (const [connectionName, data] of connectionMap.entries()) {
      if (data.points.length < 2) continue
      this.rootConnectionNameByConnectionId.set(
        connectionName,
        data.rootConnectionName,
      )
      inputConnections.push({
        connectionId: connectionName,
        start: { x: data.points[0].x, y: data.points[0].y },
        end: {
          x: data.points[data.points.length - 1].x,
          y: data.points[data.points.length - 1].y,
        },
      })
    }
    if (inputConnections.length === 0) return null

    const viaTopology = generateDefaultViaTopologyGrid({
      bounds: nodeBounds,
    })
    const result = createViaGraphWithConnections(
      {
        regions: viaTopology.regions,
        ports: viaTopology.ports,
      },
      inputConnections,
    )
    this.tiledViasByNet = viaTopology.viaTile.viasByNet ?? {}

    return new ViaGraphSolver({
      inputGraph: {
        regions: result.regions,
        ports: result.ports,
      },
      inputConnections: result.connections,
      viaTile: viaTopology.viaTile,
    })
  }

  _step() {
    let activeSubSolver = this.activeSubSolver as ViaGraphSolver | null
    if (!activeSubSolver) {
      activeSubSolver = this._initializeGraph()
      if (!activeSubSolver) {
        this.solved = true
        return
      }
      this.activeSubSolver = activeSubSolver
      this.lastActiveSubSolver = activeSubSolver
    }

    activeSubSolver.step()

    if (activeSubSolver.solved) {
      this._processResults(activeSubSolver)
      this.lastActiveSubSolver = activeSubSolver
      this.activeSubSolver = null
      this.solved = true
    } else if (activeSubSolver.failed) {
      this.error = activeSubSolver.error
      this.lastActiveSubSolver = activeSubSolver
      this.activeSubSolver = null
      this.failed = true
    }
  }

  private _getAllViaPositions(): Array<{
    position: { x: number; y: number }
    diameter: number
  }> {
    const allViaPositions: Array<{
      position: { x: number; y: number }
      diameter: number
    }> = []

    for (const vias of Object.values(this.tiledViasByNet ?? {})) {
      for (const via of vias) {
        allViaPositions.push({
          position: via.position,
          diameter: via.diameter,
        })
      }
    }

    return allViaPositions
  }

  private _findClosestVia(
    port: JPort,
    allViaPositions: ReturnType<typeof this._getAllViaPositions>,
  ): { position: { x: number; y: number }; diameter: number } | null {
    let closest: {
      position: { x: number; y: number }
      diameter: number
    } | null = null
    let minDistSquared = Infinity

    for (const via of allViaPositions) {
      const dx = via.position.x - port.d.x
      const dy = via.position.y - port.d.y
      const distSquared = dx * dx + dy * dy
      if (distSquared < minDistSquared) {
        minDistSquared = distSquared
        closest = via
      }
    }

    // max distance 1mm
    if (closest && minDistSquared < 1) {
      return closest
    }

    return null
  }

  private _upsertGlobalVia(
    viasByPosition: Map<
      string,
      {
        center: { x: number; y: number }
        diameter: number
        connectedTo: Set<string>
      }
    >,
    position: { x: number; y: number },
    diameter: number,
    connectionName: string,
  ) {
    const posKey = `${position.x.toFixed(4)},${position.y.toFixed(4)}`
    if (!viasByPosition.has(posKey)) {
      viasByPosition.set(posKey, {
        center: { x: position.x, y: position.y },
        diameter,
        connectedTo: new Set(),
      })
    }
    viasByPosition.get(posKey)!.connectedTo.add(connectionName)
  }

  private _upsertRouteViaRegion(
    routeViaRegions: ViaRegion[],
    position: { x: number; y: number },
    diameter: number,
    connectionName: string,
    regionId: string,
  ) {
    if (
      routeViaRegions.some(
        (v) =>
          Math.abs(v.center.x - position.x) < 0.01 &&
          Math.abs(v.center.y - position.y) < 0.01,
      )
    ) {
      return
    }

    routeViaRegions.push({
      viaRegionId: regionId,
      center: { x: position.x, y: position.y },
      diameter,
      connectedTo: [connectionName],
    })
  }

  private _recordViaTransition(
    viasByPosition: Map<
      string,
      {
        center: { x: number; y: number }
        diameter: number
        connectedTo: Set<string>
      }
    >,
    routeViaRegions: ViaRegion[],
    connectionName: string,
    regionId: string,
    port: JPort | null,
    allViaPositions: ReturnType<typeof this._getAllViaPositions>,
  ) {
    if (!port) return
    const viaInfo = this._findClosestVia(port, allViaPositions)
    if (!viaInfo) return

    this._upsertGlobalVia(
      viasByPosition,
      viaInfo.position,
      viaInfo.diameter,
      connectionName,
    )
    this._upsertRouteViaRegion(
      routeViaRegions,
      viaInfo.position,
      viaInfo.diameter,
      connectionName,
      regionId,
    )
  }

  private _processResults(viaGraphSolver: ViaGraphSolver) {
    this.solvedRoutes = []
    const allViaPositions = this._getAllViaPositions()
    const viasByPosition: Map<
      string,
      {
        center: { x: number; y: number }
        diameter: number
        connectedTo: Set<string>
      }
    > = new Map()

    for (const solvedRoute of viaGraphSolver.solvedRoutes) {
      const connectionName = solvedRoute.connection.connectionId
      const rootConnectionName =
        this.rootConnectionNameByConnectionId.get(connectionName)

      const routePoints: Array<{ x: number; y: number; z: number }> = []
      const routeViaRegions: ViaRegion[] = []
      let currentViaRegionId: string | null = null
      let currentViaEntryPort: JPort | null = null

      for (let i = 0; i < solvedRoute.path.length; i++) {
        const candidate = solvedRoute.path[i]
        const port = candidate.port as JPort
        const lastRegion = candidate.lastRegion as JRegion | undefined

        // Add the port position as a route point
        routePoints.push({
          x: port.d.x,
          y: port.d.y,
          z: 0,
        })

        if (!lastRegion?.d?.isViaRegion) {
          if (currentViaRegionId && currentViaEntryPort) {
            this._recordViaTransition(
              viasByPosition,
              routeViaRegions,
              connectionName,
              currentViaRegionId,
              candidate.lastPort as JPort | null,
              allViaPositions,
            )
            currentViaRegionId = null
            currentViaEntryPort = null
          }
          continue
        }

        const nextViaRegionId = lastRegion.regionId
        if (nextViaRegionId === currentViaRegionId) {
          continue
        }

        if (currentViaRegionId && currentViaEntryPort) {
          this._recordViaTransition(
            viasByPosition,
            routeViaRegions,
            connectionName,
            currentViaRegionId,
            candidate.lastPort as JPort | null,
            allViaPositions,
          )
        }

        currentViaRegionId = nextViaRegionId
        currentViaEntryPort = candidate.lastPort as JPort | null
        this._recordViaTransition(
          viasByPosition,
          routeViaRegions,
          connectionName,
          nextViaRegionId,
          currentViaEntryPort,
          allViaPositions,
        )
      }

      if (currentViaRegionId && currentViaEntryPort) {
        const lastCandidate = solvedRoute.path[solvedRoute.path.length - 1]
        if (lastCandidate) {
          this._recordViaTransition(
            viasByPosition,
            routeViaRegions,
            connectionName,
            currentViaRegionId,
            lastCandidate.port as JPort,
            allViaPositions,
          )
        }
      }

      this.solvedRoutes.push({
        connectionName,
        rootConnectionName,
        traceThickness: this.traceWidth,
        route: routePoints,
        viaRegions: routeViaRegions,
      })
    }

    let viaIndex = 0
    this.vias = Array.from(viasByPosition.values()).map((viaInfo) => ({
      viaRegionId: `via_${viaIndex++}`,
      center: viaInfo.center,
      diameter: viaInfo.diameter,
      connectedTo: Array.from(viaInfo.connectedTo),
    }))
  }

  getOutput(): HighDensityIntraNodeRouteWithVias[] {
    return this.solvedRoutes
  }

  getOutputVias(): ViaRegion[] {
    return this.vias
  }

  override visualize() {
    if (this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }
    if (this.lastActiveSubSolver) {
      return this.lastActiveSubSolver.visualize()
    }
    return super.visualize()
  }
}
