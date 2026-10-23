import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import Flatbush from "flatbush"

export type BoundaryPhysicalRules = {
  obstacles: Obstacle[]
  boardGeometry?: HighDensityBoardGeometry
  layerCount: number
  traceWidth: number
  traceWidthByConnection?: Readonly<Record<string, number>>
  traceToPadClearance?: number
  viaToPadClearance?: number
  traceToHoleClearance?: number
  viaDiameter: number
  obstacleMargin: number
  allowBlindAndBuriedVias?: boolean
}

export type BoundaryRouteCertificate = {
  interfaceKey: string
  routeKey: string
  routes: HighDensityRoute[]
}

export function indexBoundaryCopper(routes: readonly HighDensityRoute[], layerCount: number): Flatbush | undefined {
  if (routes.length === 0) return undefined
  const index = new Flatbush(routes.length)
  for (const route of routes) {
    if (route.route.length === 0 || !Number.isFinite(route.traceThickness) || route.traceThickness <= 0 || !Number.isFinite(route.viaDiameter) || route.viaDiameter <= 0 || route.route.some((point) => ![point.x, point.y, point.z, point.traceThickness ?? route.traceThickness].every(Number.isFinite) || !Number.isInteger(point.z) || point.z < 0 || point.z >= layerCount || (point.traceThickness ?? route.traceThickness) <= 0)) throw new Error(`Cannot index invalid boundary copper ${route.connectionName}`)
    const radius = Math.max(route.viaDiameter, route.traceThickness, ...route.route.map((point) => point.traceThickness ?? route.traceThickness)) / 2
    index.add(Math.min(...route.route.map((point) => point.x)) - radius, Math.min(...route.route.map((point) => point.y)) - radius,
      Math.max(...route.route.map((point) => point.x)) + radius, Math.max(...route.route.map((point) => point.y)) + radius)
  }
  index.finish()
  return index
}

/** The context is stored once; every cell proof refers to these exact inputs. */
export type BoundaryRouteCertificates = {
  context: { rulesKey: string; fixedCopperKey: string }
  cells: Record<string, BoundaryRouteCertificate>
}

export function getBoundaryPhysicalRulesKey(rules: BoundaryPhysicalRules): string {
  return JSON.stringify({
    obstacles: rules.obstacles, boardGeometry: rules.boardGeometry,
    layerCount: rules.layerCount, traceWidth: rules.traceWidth,
    traceWidthByConnection: Object.entries(rules.traceWidthByConnection ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    viaDiameter: rules.viaDiameter, obstacleMargin: rules.obstacleMargin,
    viaToPadClearance: rules.viaToPadClearance, traceToHoleClearance: rules.traceToHoleClearance,
    traceToPadClearance: rules.traceToPadClearance,
    allowBlindAndBuriedVias: rules.allowBlindAndBuriedVias ?? false,
  })
}

export function getBoundaryFixedCopperKey(routes: readonly HighDensityRoute[]): string {
  return JSON.stringify([...routes].sort((a, b) => a.connectionName.localeCompare(b.connectionName)).map((route) => ({
    connectionName: route.connectionName, rootConnectionName: route.rootConnectionName,
    traceThickness: route.traceThickness, viaDiameter: route.viaDiameter,
    startPcbPortId: route.startPcbPortId, endPcbPortId: route.endPcbPortId,
    route: route.route, vias: route.vias, jumpers: route.jumpers,
  })))
}

export function getBoundaryInterfaceKey(node: NodeWithPortPoints, connMap: ConnectivityMap): string {
  const pointKey = (point: PortPoint): unknown[] => [point.portPointId, point.connectionName,
    connMap.getNetConnectedToId(point.rootConnectionName ?? point.connectionName) ?? point.rootConnectionName ?? point.connectionName,
    point.x, point.y, point.z, point.pcb_port_id, point.prevPortPointId, point.nextPortPointId]
  return JSON.stringify({
    id: node.capacityMeshNodeId, center: node.center, width: node.width, height: node.height,
    availableZ: node.availableZ ? [...node.availableZ].sort((a, b) => a - b) : undefined,
    points: node.portPoints.map(pointKey).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    pairs: node.portPointsInPairs?.map(([a, b]) => [pointKey(a), pointKey(b)]),
  })
}

export function normalizeBoundaryNodeRoots(node: NodeWithPortPoints, connMap: ConnectivityMap): NodeWithPortPoints {
  const normalize = (point: PortPoint): PortPoint => ({ ...point,
    rootConnectionName: connMap.getNetConnectedToId(point.rootConnectionName ?? point.connectionName) ?? point.rootConnectionName ?? point.connectionName })
  return { ...node, portPoints: node.portPoints.map(normalize),
    portPointsInPairs: node.portPointsInPairs?.map(([a, b]) => [normalize(a), normalize(b)]) }
}
