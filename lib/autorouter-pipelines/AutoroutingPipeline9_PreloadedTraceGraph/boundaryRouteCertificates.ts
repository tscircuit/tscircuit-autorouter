import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import Flatbush from "flatbush"
import { getCanonicalPipeline9PortRoot } from "./getCanonicalPipeline9PortRoot"
import { Pipeline9ParametricInterfaceIndex, type Pipeline9ParametricInterfacePort } from "./Pipeline9ParametricInterfaceIndex"

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
  context: { rulesKey: string; fixedCopperKey: string; interfaceSceneKey: string }
  cells: Record<string, BoundaryRouteCertificate>
}

export function createBoundaryInterfaceIndex(
  nodes: readonly NodeWithPortPoints[],
  rules: Pick<BoundaryPhysicalRules, "traceWidth" | "traceWidthByConnection" | "layerCount">,
  connMap: ConnectivityMap,
  suppliedPorts?: readonly Pipeline9ParametricInterfacePort[],
): Pipeline9ParametricInterfaceIndex {
  const ports = suppliedPorts ?? nodes.flatMap((node) => normalizeBoundaryNodeRoots(node, connMap).portPoints.map((port) => ({
    capacityMeshNodeId: node.capacityMeshNodeId, port,
    traceWidth: Math.max(rules.traceWidth, rules.traceWidthByConnection?.[port.connectionName] ?? rules.traceWidth),
  })))
  for (const entry of ports) {
    if (getCanonicalPipeline9PortRoot(entry.port, connMap) !== entry.port.rootConnectionName || entry.traceWidth !== Math.max(rules.traceWidth, rules.traceWidthByConnection?.[entry.port.connectionName] ?? rules.traceWidth)) throw new Error("Boundary reservation has a foreign owner or incorrect nominal width")
  }
  const index = new Pipeline9ParametricInterfaceIndex(ports, rules.layerCount)
  for (const node of nodes) for (const port of normalizeBoundaryNodeRoots(node, connMap).portPoints) {
    const width = Math.max(rules.traceWidth, rules.traceWidthByConnection?.[port.connectionName] ?? rules.traceWidth)
    if (!index.hasSourceTerminal(node.capacityMeshNodeId, port, width)) throw new Error("Boundary reservation is missing an exact source terminal")
  }
  return index
}

export function getBoundaryInterfaceSceneKey(ports: readonly Pipeline9ParametricInterfacePort[]): string {
  // Canonical primitive witness rows survive worker serialization. Ordering is
  // irrelevant to this scene identity; no approximate geometry hash is used.
  return ports.map(({ capacityMeshNodeId, port, traceWidth }) => JSON.stringify([
    capacityMeshNodeId, port.portPointId, port.pcb_port_id, port.connectionName,
    port.rootConnectionName, port.x, port.y, port.z, traceWidth,
  ])).sort().join("\n")
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
    getCanonicalPipeline9PortRoot(point, connMap),
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
    rootConnectionName: getCanonicalPipeline9PortRoot(point, connMap) })
  return { ...node, portPoints: node.portPoints.map(normalize),
    portPointsInPairs: node.portPointsInPairs?.map(([a, b]) => [normalize(a), normalize(b)]) }
}
