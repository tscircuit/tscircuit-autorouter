import {
  type XYConnection as HgXYConnection,
  type JPort,
  type JRegion,
  type ViaData,
  type ViaByNet,
  type ViaTile,
  FixedViaHypergraphSolver,
} from "@tscircuit/fixed-via-hypergraph-solver/lib/index"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRoute,
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

export type HighDensityIntraNodeRouteWithVias = HighDensityIntraNodeRoute & {
  viaRegions: ViaRegion[]
}

export interface FixedTopologyHighDensityIntraNodeSolverParams {
  nodeWithPortPoints: NodeWithPortPoints
  colorMap?: Record<string, string>
  traceWidth?: number
  connMap?: ConnectivityMap
  effort?: number
}

const P99_MAX_ITERATIONS = 24411

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
  lastActiveSubSolver: FixedViaHypergraphSolver | null = null

  solvedRoutes: HighDensityIntraNodeRouteWithVias[] = []
  vias: ViaRegion[] = []

  constructor(params: FixedTopologyHighDensityIntraNodeSolverParams) {
    super()
    this.constructorParams = params
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.colorMap = params.colorMap ?? {}
    this.traceWidth = params.traceWidth ?? 0.15
    this.connMap = params.connMap
    this.MAX_ITERATIONS = P99_MAX_ITERATIONS * (params.effort ?? 1)

    // Initialize colorMap if not provided
    if (Object.keys(this.colorMap).length === 0) {
      this.colorMap = buildColorMapFromPortPoints(this.nodeWithPortPoints)
    }

    if (this.nodeWithPortPoints.availableZ?.length === 1) {
      this.error =
        "FixedTopologyHighDensityIntraNodeSolver requires at least 2 layers."
      this.failed = true
      this.solved = false
      return
    }

    const nonTopLayerPortPoint = this.nodeWithPortPoints.portPoints.find(
      (pp) => pp.z !== 0,
    )
    if (nonTopLayerPortPoint) {
      this.error =
        "FixedTopologyHighDensityIntraNodeSolver only supports top-layer (z=0) port points; found bottom-layer input."
      this.failed = true
      this.solved = false
    }
  }

  getConstructorParams(): FixedTopologyHighDensityIntraNodeSolverParams {
    return this.constructorParams
  }

  private _getViaTileDiameter(viaTile: ViaTile): number {
    for (const vias of Object.values(viaTile.viasByNet)) {
      if (vias.length > 0) return vias[0].diameter
    }
    return 0.3
  }

  private _initializeGraph(): FixedViaHypergraphSolver | null {
    // Build connections from port points
    const connectionMap = new Map<
      string,
      { points: PortPoint[]; rootConnectionName?: string }
    >()
    for (const pp of this.nodeWithPortPoints.portPoints) {
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

    return new FixedViaHypergraphSolver({ inputConnections })
  }

  _step() {
    let activeSubSolver = this
      .activeSubSolver as FixedViaHypergraphSolver | null
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

  private _appendRoutePoint(
    routePoints: Array<{ x: number; y: number; z: number }>,
    point: { x: number; y: number; z: number },
  ) {
    const lastPoint = routePoints[routePoints.length - 1]
    if (
      lastPoint &&
      Math.abs(lastPoint.x - point.x) <= 1e-6 &&
      Math.abs(lastPoint.y - point.y) <= 1e-6 &&
      lastPoint.z === point.z
    ) {
      return
    }
    routePoints.push(point)
  }

  private _parseViaRegionNetName(regionId: string): string | null {
    const marker = ":v:"
    const markerIndex = regionId.lastIndexOf(marker)
    if (markerIndex !== -1) return regionId.slice(markerIndex + marker.length)
    const lastColon = regionId.lastIndexOf(":")
    if (lastColon === -1) return regionId
    return regionId.slice(lastColon + 1)
  }

  private _parseViaRegionTilePrefix(regionId: string): string | null {
    const marker = ":v:"
    const markerIndex = regionId.lastIndexOf(marker)
    if (markerIndex <= 0) return null
    return regionId.slice(0, markerIndex)
  }

  private _selectViasForTraversedRegion(
    viaTile: ViaTile,
    viaRegion: JRegion,
  ): ViaData[] {
    const netName = this._parseViaRegionNetName(viaRegion.regionId)
    if (!netName) return []
    const viasForNet = viaTile.viasByNet[netName]
    if (!viasForNet || viasForNet.length === 0) return []

    const tilePrefix = this._parseViaRegionTilePrefix(viaRegion.regionId)
    if (!tilePrefix) return viasForNet

    const tileScopedVias = viasForNet.filter((via) =>
      via.viaId.startsWith(`${tilePrefix}:`),
    )
    return tileScopedVias.length > 0 ? tileScopedVias : viasForNet
  }

  private _findNearestVia(vias: ViaData[], point: { x: number; y: number }) {
    let best: ViaData | null = null
    let bestDistance = Infinity
    for (const via of vias) {
      const dx = via.position.x - point.x
      const dy = via.position.y - point.y
      const distance = dx * dx + dy * dy
      if (distance < bestDistance) {
        bestDistance = distance
        best = via
      }
    }
    return best
  }

  private _getBottomRoutePointsBetweenVias(
    viaTile: ViaTile,
    viasForRegion: ViaData[],
    entryVia: ViaData,
    exitVia: ViaData,
  ): Array<{ x: number; y: number }> | null {
    if (entryVia.viaId === exitVia.viaId) {
      return [entryVia.position]
    }

    const viaIdSet = new Set(viasForRegion.map((via) => via.viaId))
    const bottomSegments = viaTile.routeSegments.filter(
      (routeSegment) =>
        routeSegment.layer === "bottom" &&
        routeSegment.segments.length >= 2 &&
        viaIdSet.has(routeSegment.fromPort) &&
        viaIdSet.has(routeSegment.toPort),
    )

    const adjacency = new Map<
      string,
      Array<{ to: string; points: Array<{ x: number; y: number }> }>
    >()
    const addEdge = (
      from: string,
      to: string,
      points: Array<{ x: number; y: number }>,
    ) => {
      if (!adjacency.has(from)) adjacency.set(from, [])
      adjacency.get(from)!.push({ to, points })
    }

    for (const routeSegment of bottomSegments) {
      addEdge(routeSegment.fromPort, routeSegment.toPort, routeSegment.segments)
      addEdge(
        routeSegment.toPort,
        routeSegment.fromPort,
        [...routeSegment.segments].reverse(),
      )
    }

    const queue = [entryVia.viaId]
    const visited = new Set<string>([entryVia.viaId])
    const prev = new Map<
      string,
      { from: string; points: Array<{ x: number; y: number }> }
    >()

    while (queue.length > 0) {
      const viaId = queue.shift()!
      if (viaId === exitVia.viaId) break
      for (const edge of adjacency.get(viaId) ?? []) {
        if (visited.has(edge.to)) continue
        visited.add(edge.to)
        prev.set(edge.to, { from: viaId, points: edge.points })
        queue.push(edge.to)
      }
    }

    if (!prev.has(exitVia.viaId)) return null

    const edgeChain: Array<Array<{ x: number; y: number }>> = []
    let cursor = exitVia.viaId
    while (cursor !== entryVia.viaId) {
      const step = prev.get(cursor)
      if (!step) return null
      edgeChain.push(step.points)
      cursor = step.from
    }
    edgeChain.reverse()

    const pathPoints: Array<{ x: number; y: number }> = []
    for (const points of edgeChain) {
      for (const point of points) {
        const lastPoint = pathPoints[pathPoints.length - 1]
        if (
          !lastPoint ||
          Math.abs(lastPoint.x - point.x) > 1e-6 ||
          Math.abs(lastPoint.y - point.y) > 1e-6
        ) {
          pathPoints.push(point)
        }
      }
    }

    return pathPoints.length > 0 ? pathPoints : null
  }

  private _appendViaUsage(
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
    via: ViaData | null,
  ) {
    if (!via) return
    this._upsertGlobalVia(
      viasByPosition,
      via.position,
      via.diameter,
      connectionName,
    )
    this._upsertRouteViaRegion(
      routeViaRegions,
      via.position,
      via.diameter,
      connectionName,
      regionId,
    )
  }

  private _processResults(viaGraphSolver: FixedViaHypergraphSolver) {
    this.solvedRoutes = []
    const viaTile = viaGraphSolver.viaTile
    const fallbackViaDiameter = viaTile
      ? this._getViaTileDiameter(viaTile)
      : 0.3
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
      const path = solvedRoute.path

      if (path.length === 0) continue

      const firstPort = path[0].port as JPort
      this._appendRoutePoint(routePoints, {
        x: firstPort.d.x,
        y: firstPort.d.y,
        z: 0,
      })

      for (let i = 1; i < path.length; i++) {
        const previousCandidate = path[i - 1]
        const currentCandidate = path[i]
        const previousPoint = {
          x: previousCandidate.port.d.x,
          y: previousCandidate.port.d.y,
        }
        const currentPoint = {
          x: currentCandidate.port.d.x,
          y: currentCandidate.port.d.y,
        }
        const traversedRegion = currentCandidate.lastRegion as
          | JRegion
          | undefined

        if (!traversedRegion?.d?.isViaRegion || !viaTile) {
          this._appendRoutePoint(routePoints, {
            x: currentPoint.x,
            y: currentPoint.y,
            z: 0,
          })
          continue
        }

        const viasForRegion = this._selectViasForTraversedRegion(
          viaTile,
          traversedRegion,
        )
        if (viasForRegion.length === 0) {
          this._appendRoutePoint(routePoints, {
            x: currentPoint.x,
            y: currentPoint.y,
            z: 0,
          })
          continue
        }

        const entryVia = this._findNearestVia(viasForRegion, previousPoint)
        const exitVia = this._findNearestVia(viasForRegion, currentPoint)

        if (!entryVia || !exitVia) {
          this._appendRoutePoint(routePoints, {
            x: currentPoint.x,
            y: currentPoint.y,
            z: 0,
          })
          continue
        }

        const bottomPoints = this._getBottomRoutePointsBetweenVias(
          viaTile,
          viasForRegion,
          entryVia,
          exitVia,
        )
        if (!bottomPoints || bottomPoints.length === 0) {
          this._appendRoutePoint(routePoints, {
            x: currentPoint.x,
            y: currentPoint.y,
            z: 0,
          })
          continue
        }

        this._appendViaUsage(
          viasByPosition,
          routeViaRegions,
          connectionName,
          traversedRegion.regionId,
          entryVia,
        )
        this._appendViaUsage(
          viasByPosition,
          routeViaRegions,
          connectionName,
          traversedRegion.regionId,
          exitVia,
        )

        this._appendRoutePoint(routePoints, {
          x: entryVia.position.x,
          y: entryVia.position.y,
          z: 0,
        })
        this._appendRoutePoint(routePoints, {
          x: entryVia.position.x,
          y: entryVia.position.y,
          z: 1,
        })

        for (const point of bottomPoints) {
          this._appendRoutePoint(routePoints, { x: point.x, y: point.y, z: 1 })
        }

        this._appendRoutePoint(routePoints, {
          x: exitVia.position.x,
          y: exitVia.position.y,
          z: 1,
        })
        this._appendRoutePoint(routePoints, {
          x: exitVia.position.x,
          y: exitVia.position.y,
          z: 0,
        })

        this._appendRoutePoint(routePoints, {
          x: currentPoint.x,
          y: currentPoint.y,
          z: 0,
        })
      }

      const routeVias = routeViaRegions.map((viaRegion) => ({
        x: viaRegion.center.x,
        y: viaRegion.center.y,
      }))

      this.solvedRoutes.push({
        connectionName,
        rootConnectionName,
        traceThickness: this.traceWidth,
        viaDiameter:
          routeViaRegions.length > 0
            ? Math.max(
                ...routeViaRegions.map((viaRegion) => viaRegion.diameter),
              )
            : fallbackViaDiameter,
        route: routePoints,
        vias: routeVias,
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

  override visualize(): GraphicsObject {
    if (this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }
    if (this.lastActiveSubSolver) {
      return this.lastActiveSubSolver.visualize()
    }
    return super.visualize()
  }
}
