import type {
  ChangedPreloadedTraceSection,
  PreloadedTraceSectionEndpointWitness,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { getConnectionPointLayer } from "lib/types/srj-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type Point = { x: number; y: number; z: number }
type Params = {
  /** Empty constructor inspection has no physical seam jobs to certify. */
  sourceSrj: SimpleRouteJson | undefined
  sections: ChangedPreloadedTraceSection[]
  witnesses: PreloadedTraceSectionEndpointWitness[]
  nodes: NodeWithPortPoints[]
  viaDiameter: number
}
type Result = {
  nodes: NodeWithPortPoints[]
  immutablePortIds: Set<string>
  immutablePortPositions: Map<string, { x: number; y: number }>
  endpointCount: number
  pinnedReplicaCount: number
  maximumDisplacement: number
  ownedConnectors: HighDensityRoute[]
}

type PinnedWitness = PreloadedTraceSectionEndpointWitness & { routingPoint: Point }

function matchesWithinRoundoff(left: Point, right: Point): boolean {
  const scale = Math.max(1, Math.abs(left.x), Math.abs(left.y), Math.abs(right.x), Math.abs(right.y))
  const tolerance = Math.min(1e-9, 64 * Number.EPSILON * scale)
  return [left.x, left.y, left.z, right.x, right.y, right.z].every(Number.isFinite) &&
    left.z === right.z && Math.abs(left.x - right.x) <= tolerance &&
    Math.abs(left.y - right.y) <= tolerance
}

function getOriginalSeamPoint(trace: SimplifiedPcbTrace, position: number, z: number, layerCount: number): Point {
  if (!Number.isFinite(position) || position < 0 || position > trace.route.length - 1) {
    throw new Error(`Preloaded seam has invalid original interval: ${trace.pcb_trace_id}`)
  }
  const index = Math.floor(position)
  const fraction = position - index
  const start = trace.route[index]!
  if (start.route_type === "wire") {
    const startZ = mapLayerNameToZ(start.layer, layerCount)
    if (fraction === 0) return { x: start.x, y: start.y, z: startZ }
    const end = trace.route[index + 1]
    if (end?.route_type === "wire" && end.layer === start.layer) {
      return { x: start.x + (end.x - start.x) * fraction,
        y: start.y + (end.y - start.y) * fraction, z: startZ }
    }
  } else if (start.route_type === "via" && fraction === 0) {
    const from = mapLayerNameToZ(start.from_layer, layerCount)
    const to = mapLayerNameToZ(start.to_layer, layerCount)
    if (z >= Math.min(from, to) && z <= Math.max(from, to)) return { x: start.x, y: start.y, z }
  } else if (start.route_type === "through_obstacle") {
    const from = mapLayerNameToZ(start.from_layer, layerCount)
    const to = mapLayerNameToZ(start.to_layer, layerCount)
    if (z >= Math.min(from, to) && z <= Math.max(from, to)) {
      return { x: start.start.x + (start.end.x - start.start.x) * fraction,
        y: start.start.y + (start.end.y - start.start.y) * fraction, z }
    }
  } else if (start.route_type === "jumper" && fraction === 0) {
    return { ...start.start, z: mapLayerNameToZ(start.layer, layerCount) }
  }
  throw new Error(`Preloaded seam has unsupported original interval: ${trace.pcb_trace_id}`)
}

function isPointInNode(point: Point, node: NodeWithPortPoints): boolean {
  const tolerance = Math.min(1e-9, 64 * Number.EPSILON * Math.max(1, Math.abs(node.center.x), Math.abs(node.center.y), node.width, node.height))
  return point.x >= node.center.x - node.width / 2 - tolerance && point.x <= node.center.x + node.width / 2 + tolerance &&
    point.y >= node.center.y - node.height / 2 - tolerance && point.y <= node.center.y + node.height / 2 + tolerance &&
    (!node.availableZ || node.availableZ.includes(point.z))
}

/** Clip the original wire itself; a lateral attachment would add new copper. */
function getClippedOwnedConnector(
  trace: SimplifiedPcbTrace,
  witness: PreloadedTraceSectionEndpointWitness,
  nodes: NodeWithPortPoints[],
  layerCount: number,
  viaDiameter: number,
): { point: Point; connector: HighDensityRoute } {
  let index = Math.floor(witness.routePosition)
  let a = trace.route[index]
  let b = trace.route[index + 1]
  if (witness.routePosition === index && (a?.route_type !== "wire" || b?.route_type !== "wire" || a.layer !== b.layer)) {
    index--
    a = trace.route[index]
    b = trace.route[index + 1]
  }
  if (a?.route_type !== "wire" || b?.route_type !== "wire" || a.layer !== b.layer ||
    mapLayerNameToZ(a.layer, layerCount) !== witness.point.z ||
    !Number.isFinite(a.width) || a.width <= 0 || !Number.isFinite(b.width) || b.width <= 0) {
    throw new Error(`Preloaded seam has no owned planar span into its cell: ${witness.portPointId}`)
  }
  let lower = 0
  let upper = 1
  for (const node of nodes) for (const axis of ["x", "y"] as const) {
    const delta = b[axis] - a[axis]
    const size = axis === "x" ? node.width : node.height
    const minimum = node.center[axis] - size / 2
    const maximum = node.center[axis] + size / 2
    if (delta === 0) {
      if (a[axis] < minimum || a[axis] > maximum) throw new Error(`Preloaded original span misses incident domain: ${witness.portPointId}`)
      continue
    }
    const first = (minimum - a[axis]) / delta
    const last = (maximum - a[axis]) / delta
    lower = Math.max(lower, Math.min(first, last))
    upper = Math.min(upper, Math.max(first, last))
  }
  if (lower > upper) throw new Error(`Preloaded original span misses incident domain: ${witness.portPointId}`)
  const sourceFraction = witness.routePosition - index
  const fraction = Math.max(lower, Math.min(upper, sourceFraction))
  const point = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, z: witness.point.z }
  if (nodes.some((node) => !isPointInNode(point, node))) throw new Error(`Preloaded original span has invalid clipped domain: ${witness.portPointId}`)
  const width = a.width
  const connector = {
    connectionName: witness.connectionName, rootConnectionName: witness.rootConnectionName,
    traceThickness: width, viaDiameter,
    route: [{ ...witness.point, traceThickness: width }, { ...point, traceThickness: width }], vias: [],
    originalPreloadedSpan: {
      traceId: trace.pcb_trace_id, wireRouteIndex: index,
      startFraction: sourceFraction, endFraction: fraction, width,
    },
  }
  return { point, connector }
}

/** Restore only seams certified by original copper, serialized ownership and incidence. */
export function pinPipeline9PreloadedSectionEndpoints(params: Params): Result {
  if (!Number.isFinite(params.viaDiameter) || params.viaDiameter <= 0) throw new Error("Preloaded seam pinning requires a positive via diameter")
  if (params.sections.length === 0 && params.witnesses.length === 0) {
    return { nodes: params.nodes, immutablePortIds: new Set(), immutablePortPositions: new Map(),
      endpointCount: 0, pinnedReplicaCount: 0, maximumDisplacement: 0, ownedConnectors: [] }
  }
  if (!params.sourceSrj) throw new Error("Preloaded seam pinning requires source provenance for nonempty jobs")
  const sourceSrj = params.sourceSrj
  const traces = sourceSrj.traces ?? []
  const traceById = new Map(traces.map((trace) => [trace.pcb_trace_id, trace]))
  const sectionByName = new Map(params.sections.map((section) => [section.connectionName, section]))
  const nodeById = new Map(params.nodes.map((node) => [node.capacityMeshNodeId, node]))
  const nodesByPort = new Map<string, Set<NodeWithPortPoints>>()
  for (const node of params.nodes) for (const point of node.portPoints) {
    if (!point.portPointId) continue
    const owners = nodesByPort.get(point.portPointId) ?? new Set<NodeWithPortPoints>()
    owners.add(node)
    nodesByPort.set(point.portPointId, owners)
  }
  if (traceById.size !== traces.length || sectionByName.size !== params.sections.length || nodeById.size !== params.nodes.length) {
    throw new Error("Preloaded seam pinning received duplicate source identities")
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(sourceSrj)
  const witnessByPort = new Map<string, PinnedWitness>()
  const ownedConnectors: HighDensityRoute[] = []
  const seenEndpoints = new Set<string>()
  for (const witness of params.witnesses) {
    const section = sectionByName.get(witness.connectionName as ChangedPreloadedTraceSection["connectionName"])
    const trace = traceById.get(witness.traceId)
    const key = JSON.stringify([witness.connectionName, witness.endpointIndex])
    const terminal = section?.connection.pointsToConnect[witness.endpointIndex]
    const position = witness.endpointIndex === 0 ? section?.startRoutePosition : section?.endRoutePosition
    if (!section || !trace || !terminal || section.traceId !== witness.traceId ||
      section.connection.name !== witness.connectionName || position !== witness.routePosition ||
      seenEndpoints.has(key) || !witness.portPointId || !witness.sourcePortPointId ||
      ![0, 1].includes(witness.endpointIndex)) {
      throw new Error(`Preloaded seam lost its declared interval identity: ${witness.connectionName}`)
    }
    seenEndpoints.add(key)
    const root = connMap.getNetConnectedToId(trace.connection_name)
    if (!root || root !== witness.rootConnectionName ||
      !section.connection.__rootConnectionNames?.includes(root)) {
      throw new Error(`Preloaded seam has wrong source root: ${witness.connectionName}`)
    }
    const declared = { x: terminal.x, y: terminal.y,
      z: mapLayerNameToZ(getConnectionPointLayer(terminal), sourceSrj.layerCount) }
    const original = getOriginalSeamPoint(trace, witness.routePosition, witness.point.z, sourceSrj.layerCount)
    if (!Number.isInteger(witness.point.z) || witness.point.z < 0 || witness.point.z >= sourceSrj.layerCount ||
      !matchesWithinRoundoff(original, witness.point) ||
      declared.x !== witness.point.x || declared.y !== witness.point.y || declared.z !== witness.point.z ||
      witness.sourcePortPoint.z !== witness.point.z ||
      ![witness.sourcePortPoint.x, witness.sourcePortPoint.y].every(Number.isFinite)) {
      throw new Error(`Preloaded seam disagrees with original copper or layer: ${witness.connectionName}`)
    }
    if (new Set(witness.incidentCapacityMeshNodeIds).size !== 2) {
      throw new Error(`Preloaded seam has invalid source incidence: ${witness.portPointId}`)
    }
    const incidentNodes = [...(nodesByPort.get(witness.portPointId) ?? [])]
    if (incidentNodes.length === 0 || incidentNodes.some((node) => !witness.incidentCapacityMeshNodeIds.includes(node.capacityMeshNodeId))) {
      throw new Error(`Preloaded seam has wrong incident region: ${witness.portPointId}`)
    }
    for (const node of incidentNodes) {
      if (![node.center.x, node.center.y, node.width, node.height].every(Number.isFinite) ||
        node.width <= 0 || node.height <= 0 ||
        (node.availableZ && !node.availableZ.includes(witness.point.z)) ||
        !isPointInNode(witness.sourcePortPoint, node)) {
        throw new Error(`Preloaded seam lies outside incident physical domain: ${witness.portPointId}`)
      }
    }
    const clipped = incidentNodes.every((node) => isPointInNode(witness.point, node))
      ? undefined
      : getClippedOwnedConnector(trace, witness, incidentNodes, sourceSrj.layerCount, params.viaDiameter)
    const routingPoint = clipped?.point ?? witness.point
    if (clipped) ownedConnectors.push(clipped.connector)
    const previous = witnessByPort.get(witness.portPointId)
    if (previous && (previous.rootConnectionName !== root || previous.point.x !== witness.point.x ||
      previous.point.y !== witness.point.y || previous.point.z !== witness.point.z ||
      previous.traceId !== witness.traceId || previous.routePosition !== witness.routePosition ||
      previous.sourcePortPointId !== witness.sourcePortPointId ||
      previous.routingPoint.x !== routingPoint.x || previous.routingPoint.y !== routingPoint.y ||
      previous.routingPoint.z !== routingPoint.z)) {
      throw new Error(`Preloaded seam has conflicting physical witnesses: ${witness.portPointId}`)
    }
    witnessByPort.set(witness.portPointId, { ...witness, routingPoint })
  }
  if (seenEndpoints.size !== params.sections.length * 2) throw new Error("Preloaded seam pinning lost endpoint witnesses")
  let pinnedReplicaCount = 0
  let maximumDisplacement = 0
  const pin = (point: PortPoint, nodeId: string): PortPoint => {
    const witness = point.portPointId ? witnessByPort.get(point.portPointId) : undefined
    if (!witness) return point
    const root = point.connectionName === witness.connectionName
      ? point.rootConnectionName : connMap.getNetConnectedToId(point.connectionName)
    if (root !== witness.rootConnectionName || point.z !== witness.point.z ||
      ![point.x, point.y].every(Number.isFinite) ||
      !witness.incidentCapacityMeshNodeIds.includes(nodeId) ||
      (point.pcb_port_id && (point.x !== witness.routingPoint.x || point.y !== witness.routingPoint.y))) {
      throw new Error(`Preloaded seam has conflicting endpoint replica: ${point.portPointId}`)
    }
    maximumDisplacement = Math.max(maximumDisplacement, Math.hypot(point.x - witness.routingPoint.x, point.y - witness.routingPoint.y))
    pinnedReplicaCount++
    return { ...point, x: witness.routingPoint.x, y: witness.routingPoint.y }
  }
  const nodes: NodeWithPortPoints[] = params.nodes.map((node) => ({ ...node,
      portPoints: node.portPoints.map((point) => pin(point, node.capacityMeshNodeId)),
      portPointsInPairs: node.portPointsInPairs?.map(([a, b]) => [pin(a, node.capacityMeshNodeId), pin(b, node.capacityMeshNodeId)]),
    }))
  return {
    nodes,
    immutablePortIds: new Set(witnessByPort.keys()),
    immutablePortPositions: new Map([...witnessByPort].map(([id, witness]) => [id, { x: witness.routingPoint.x, y: witness.routingPoint.y }])),
    endpointCount: seenEndpoints.size,
    pinnedReplicaCount,
    maximumDisplacement,
    ownedConnectors,
  }
}
