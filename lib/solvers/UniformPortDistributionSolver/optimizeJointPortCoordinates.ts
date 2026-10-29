import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import type { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import { indexPortPointOwnerNodes } from "./determineOwnerPair"
import { getSharedEdgeForNodePair } from "./getSharedEdgeForNodePair"
import type { Bounds, SharedEdge } from "./types"

type Position = { x: number; y: number }
type Occurrence = { node: NodeWithPortPoints; point: PortPoint }
type MovablePort = {
  id: string
  point: PortPoint
  edge: SharedEdge
  owners: [NodeWithPortPoints, NodeWithPortPoints]
  partners: [PortPoint, PortPoint]
}

export type JointPortCoordinateStats = {
  active: true
  candidatePortCount: number
  boundedNodeCount: number
  geometricPortCount: number
  sameLayerPortCount: number
  eligiblePortCount: number
  movedPortCount: number
  acceptedMoveCount: number
  objectiveBefore: number
  objectiveAfter: number
  unsupportedGeometry: boolean
}

const EPSILON = 1e-8
const SWEEPS = 4
const SEARCH_STEPS = 36

/** Conservative boxes include rotated pads and all existing routed copper. */
function getBlockedBounds(srj: SimpleRouteJson): Bounds[] | null {
  const blocked: Bounds[] = []
  for (const obstacle of srj.obstacles) {
    // Legacy datasets also carry oval/circle obstacle types. Their copper is
    // contained by the same rotated width/height envelope; no shape weakening.
    const obstacleType = String(obstacle.type)
    if (
      !["rect", "oval", "circle"].includes(obstacleType) ||
      (obstacle.shape !== undefined && obstacle.shape !== "circle") ||
      ![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height,
        obstacle.ccwRotationDegrees ?? 0].every(Number.isFinite) ||
      obstacle.width < 0 || obstacle.height < 0
    ) return null
    const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const circular = obstacle.shape === "circle" || obstacleType === "circle"
    const halfWidth = circular
      ? Math.max(obstacle.width, obstacle.height) / 2
      : (Math.abs(Math.cos(angle)) * obstacle.width +
          Math.abs(Math.sin(angle)) * obstacle.height) / 2
    const halfHeight = circular
      ? halfWidth
      : (Math.abs(Math.sin(angle)) * obstacle.width +
          Math.abs(Math.cos(angle)) * obstacle.height) / 2
    blocked.push({ minX: obstacle.center.x - halfWidth,
      maxX: obstacle.center.x + halfWidth,
      minY: obstacle.center.y - halfHeight, maxY: obstacle.center.y + halfHeight })
  }
  for (const trace of srj.traces ?? []) {
    for (let i = 0; i < trace.route.length; i++) {
      const point = trace.route[i]
      if (point.route_type === "jumper") return null
      if (point.route_type === "through_obstacle") {
        const radius = point.width / 2
        if (![point.start.x, point.start.y, point.end.x, point.end.y, radius]
          .every(Number.isFinite) || radius < 0) return null
        blocked.push({ minX: Math.min(point.start.x, point.end.x) - radius,
          maxX: Math.max(point.start.x, point.end.x) + radius,
          minY: Math.min(point.start.y, point.end.y) - radius,
          maxY: Math.max(point.start.y, point.end.y) + radius })
        continue
      }
      if (point.route_type !== "wire" && point.route_type !== "via") return null
      const next = trace.route[i + 1]
      const end = next?.route_type === "wire" || next?.route_type === "via"
        ? next : point
      const radius = point.route_type === "wire" ? point.width / 2
        : (point.via_diameter ?? srj.minViaPadDiameter ??
            srj.min_via_pad_diameter ?? srj.minViaDiameter ?? 0.3) / 2
      const endRadius = end.route_type === "wire" ? end.width / 2
        : (end.via_diameter ?? srj.minViaPadDiameter ??
            srj.min_via_pad_diameter ?? srj.minViaDiameter ?? 0.3) / 2
      const copperRadius = Math.max(radius, endRadius)
      if (![point.x, point.y, end.x, end.y, copperRadius].every(Number.isFinite) ||
        copperRadius < 0) return null
      blocked.push({ minX: Math.min(point.x, end.x) - copperRadius,
        maxX: Math.max(point.x, end.x) + copperRadius,
        minY: Math.min(point.y, end.y) - copperRadius,
        maxY: Math.max(point.y, end.y) + copperRadius })
    }
  }
  return blocked
}

/** Reject ambiguous domains rather than moving ports outside their actual node. */
function hasValidNodeDomain(
  node: NodeWithPortPoints,
  bounds: Bounds,
): boolean {
  if (![node.center.x, node.center.y, node.width, node.height].every(Number.isFinite) ||
    node.width <= 0 || node.height <= 0 ||
    node.portPoints.some((point) => ![point.x, point.y, point.z].every(Number.isFinite) ||
      point.x < bounds.minX - EPSILON || point.x > bounds.maxX + EPSILON ||
      point.y < bounds.minY - EPSILON || point.y > bounds.maxY + EPSILON)) return false
  return true
}

/** Separating axes certify the entire swept wire triangle, including its edges. */
function intersectsSweptTriangle(
  triangle: [Position, Position, Position],
  bounds: Bounds,
  margin: number,
): boolean {
  const axes = [{ x: 1, y: 0 }, { x: 0, y: 1 }]
  for (let i = 0; i < 3; i++) {
    const next = triangle[(i + 1) % 3]
    axes.push({ x: next.y - triangle[i].y, y: triangle[i].x - next.x })
  }
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  const halfWidth = (bounds.maxX - bounds.minX) / 2 + margin
  const halfHeight = (bounds.maxY - bounds.minY) / 2 + margin
  for (const axis of axes) {
    if (axis.x === 0 && axis.y === 0) continue
    const projected = triangle.map((point) => point.x * axis.x + point.y * axis.y)
    const center = centerX * axis.x + centerY * axis.y
    const radius = Math.abs(axis.x) * halfWidth + Math.abs(axis.y) * halfHeight
    if (Math.max(...projected) < center - radius - EPSILON ||
      Math.min(...projected) > center + radius + EPSILON) return false
  }
  return true
}

/** Every swept point and segment must stay inside the physical board. */
function isSweptTriangleOnBoard(
  triangle: [Position, Position, Position],
  srj: SimpleRouteJson,
  margin: number,
): boolean {
  if (triangle.some((point) => point.x - margin < srj.bounds.minX ||
    point.x + margin > srj.bounds.maxX || point.y - margin < srj.bounds.minY ||
    point.y + margin > srj.bounds.maxY)) return false
  if (srj.outline === undefined) return true
  if (triangle.some((point) => !isPointInOrOnPolygon(point, srj.outline!))) return false
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < srj.outline.length; j++) {
      if (minimumDistanceBetweenSegments(triangle[i], triangle[(i + 1) % 3],
        srj.outline[j], srj.outline[(j + 1) % srj.outline.length]) <= margin) return false
    }
  }
  return true
}

/** Shrink each endpoint to a certified obstacle-free swept interval. */
function getClearSweptInterval(
  port: MovablePort,
  interval: [number, number],
  positions: ReadonlyMap<string, Position>,
  blockedByNode: ReadonlyMap<string, Bounds[]>,
  srj: SimpleRouteJson,
  padMargin: number,
  boardMargin: number,
): [number, number] | null {
  const current = positions.get(port.id)!
  const vertical = port.edge.orientation === "vertical"
  const previous = vertical ? current.y : current.x
  const isClear = (coordinate: number): boolean => {
    const proposed = vertical ? { x: current.x, y: coordinate } : { x: coordinate, y: current.y }
    for (let i = 0; i < 2; i++) {
      const partner = port.partners[i]
      const endpoint = partner.portPointId ? positions.get(partner.portPointId) ?? partner : partner
      const triangle: [Position, Position, Position] = [endpoint, current, proposed]
      if (!isSweptTriangleOnBoard(triangle, srj, boardMargin) ||
        blockedByNode.get(port.owners[i].capacityMeshNodeId)!.some((bounds) =>
          intersectsSweptTriangle(triangle, bounds, padMargin))) return false
    }
    return true
  }
  if (!isClear(previous)) return null
  const result: [number, number] = [...interval]
  for (let side = 0; side < 2; side++) {
    if (isClear(result[side])) continue
    let safe = previous
    let blocked = result[side]
    for (let step = 0; step < 20; step++) {
      const midpoint = (safe + blocked) / 2
      if (isClear(midpoint)) safe = midpoint
      else blocked = midpoint
    }
    result[side] = safe
  }
  return result
}

/** Keep the original connected legal interval; never jump over another port. */
function getLegalInterval(
  port: MovablePort,
  positions: ReadonlyMap<string, Position>,
  pitch: number,
): [number, number] | null {
  const vertical = port.edge.orientation === "vertical"
  const current = positions.get(port.id)!
  const coordinate = vertical ? current.y : current.x
  let lower = (vertical ? port.edge.y1 : port.edge.x1) + pitch
  let upper = (vertical ? port.edge.y2 : port.edge.x2) - pitch
  for (const node of port.owners) {
    for (const other of node.portPoints) {
      if (other.portPointId === port.id || other.z !== port.point.z) continue
      const position = other.portPointId ? positions.get(other.portPointId) ?? other : other
      const normalDistance = Math.abs(vertical ? current.x - position.x : current.y - position.y)
      if (normalDistance >= pitch) continue
      const radius = Math.sqrt(Math.max(0, pitch * pitch - normalDistance * normalDistance))
      const otherCoordinate = vertical ? position.y : position.x
      if (coordinate <= otherCoordinate - radius + EPSILON) {
        upper = Math.min(upper, otherCoordinate - radius)
      } else if (coordinate >= otherCoordinate + radius - EPSILON) {
        lower = Math.max(lower, otherCoordinate + radius)
      } else return null
    }
  }
  return lower <= upper && coordinate >= lower - EPSILON && coordinate <= upper + EPSILON
    ? [lower, upper] : null
}

/** Bounded coordinate descent couples each port to both neighboring routes. */
export function optimizeJointPortCoordinates({
  nodes,
  inputNodes,
  srj,
}: {
  nodes: NodeWithPortPoints[]
  inputNodes: InputNodeWithPortPoints[]
  srj: SimpleRouteJson
}): { nodes: NodeWithPortPoints[]; stats: JointPortCoordinateStats } {
  const stats: JointPortCoordinateStats = { active: true, candidatePortCount: 0,
    boundedNodeCount: 0, geometricPortCount: 0, sameLayerPortCount: 0,
    eligiblePortCount: 0, movedPortCount: 0, acceptedMoveCount: 0,
    objectiveBefore: 0, objectiveAfter: 0, unsupportedGeometry: false }
  const blocked = getBlockedBounds(srj)
  const traceWidth = Math.max(srj.minTraceWidth, srj.nominalTraceWidth ?? 0,
    ...srj.connections.map((connection) => connection.nominalTraceWidth ?? connection.width ?? 0),
    ...(srj.buses ?? []).map((bus) => bus.traceWidth ?? 0))
  const clearance = Math.max(srj.defaultObstacleMargin ?? 0.15,
    srj.minTraceToPadEdgeClearance ?? 0, srj.minTraceToHoleEdgeClearance ?? 0)
  const boardClearance = srj.minBoardEdgeClearance ?? 0
  if (blocked === null || ![traceWidth, clearance, boardClearance,
    srj.bounds.minX, srj.bounds.maxX, srj.bounds.minY, srj.bounds.maxY].every(Number.isFinite) ||
    traceWidth <= 0 || clearance < 0 || boardClearance < 0 ||
    (srj.outline !== undefined && (srj.outline.length < 3 || srj.outline.some((point) =>
      ![point.x, point.y].every(Number.isFinite))))) {
    stats.unsupportedGeometry = true
    return { nodes, stats }
  }
  const nodeBounds = new Map<string, Bounds>()
  const clearNodes = new Map<string, boolean>()
  const blockedByNode = new Map<string, Bounds[]>()
  const inputByNode = new Map(inputNodes.map((node) => [node.capacityMeshNodeId, node]))
  const occurrences = new Map<string, Occurrence[]>()
  const pairOccurrences = new Map<string, number>()
  for (const node of nodes) {
    const bounds = { minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2 }
    nodeBounds.set(node.capacityMeshNodeId, bounds)
    const original = inputByNode.get(node.capacityMeshNodeId)
    clearNodes.set(node.capacityMeshNodeId, !!original && !original._containsTarget &&
      !original._containsObstacle && hasValidNodeDomain(node, bounds))
    if (clearNodes.get(node.capacityMeshNodeId)) stats.boundedNodeCount++
    const margin = traceWidth / 2 + clearance
    blockedByNode.set(node.capacityMeshNodeId, blocked.filter((obstacle) =>
      bounds.minX - margin <= obstacle.maxX && bounds.maxX + margin >= obstacle.minX &&
      bounds.minY - margin <= obstacle.maxY && bounds.maxY + margin >= obstacle.minY))
    for (const point of node.portPoints) {
      if (!point.portPointId) continue
      const copies = occurrences.get(point.portPointId) ?? []
      copies.push({ node, point })
      occurrences.set(point.portPointId, copies)
    }
    for (const pair of node.portPointsInPairs ?? []) {
      for (const point of pair) {
        if (point.portPointId) {
          pairOccurrences.set(point.portPointId,
            (pairOccurrences.get(point.portPointId) ?? 0) + 1)
        }
      }
    }
  }
  const owners = indexPortPointOwnerNodes(inputNodes)
  const ambiguousOwners = new Set<string>()
  for (const node of inputNodes) {
    for (const point of node.portPoints) {
      const pair = owners.get(point.portPointId)
      const actual = point.connectionNodeIds
      if (!pair || !actual || actual.length !== 2 ||
        !((pair[0] === actual[0] && pair[1] === actual[1]) ||
          (pair[0] === actual[1] && pair[1] === actual[0]))) {
        ambiguousOwners.add(point.portPointId)
      }
    }
  }
  const positions = new Map<string, Position>()
  const movable: MovablePort[] = []
  for (const [id, copies] of occurrences) {
    const pair = owners.get(id)
    if (!pair || ambiguousOwners.has(id) || pair[0] === pair[1] || copies.length !== 2 ||
      pairOccurrences.get(id) !== 2) continue
    stats.candidatePortCount++
    const first = copies.find((copy) => copy.node.capacityMeshNodeId === pair[0])
    const second = copies.find((copy) => copy.node.capacityMeshNodeId === pair[1])
    if (!first || !second || !clearNodes.get(pair[0]) || !clearNodes.get(pair[1])) continue
    const point = first.point
    if (point.pcb_port_id || second.point.pcb_port_id ||
      point.z !== second.point.z || point.connectionName !== second.point.connectionName ||
      !Number.isInteger(point.z) || point.z < 0 || point.z >= srj.layerCount ||
      !inputByNode.get(pair[0])!.availableZ.includes(point.z) ||
      !inputByNode.get(pair[1])!.availableZ.includes(point.z) ||
      (first.node.availableZ !== undefined && !first.node.availableZ.includes(point.z)) ||
      (second.node.availableZ !== undefined && !second.node.availableZ.includes(point.z)) ||
      point.rootConnectionName !== second.point.rootConnectionName ||
      Math.abs(point.x - second.point.x) > EPSILON || Math.abs(point.y - second.point.y) > EPSILON ||
      srj.connections.some((connection) => connection.pointsToConnect.some((terminal) =>
        Math.abs(terminal.x - point.x) <= EPSILON && Math.abs(terminal.y - point.y) <= EPSILON))) continue
    const edge = getSharedEdgeForNodePair({ nodeAId: pair[0], nodeBId: pair[1], nodeBounds })
    if (!edge || (edge.orientation === "vertical"
      ? Math.abs(point.x - edge.x1) > EPSILON || point.y < edge.y1 || point.y > edge.y2
      : Math.abs(point.y - edge.y1) > EPSILON || point.x < edge.x1 || point.x > edge.x2)) continue
    stats.geometricPortCount++
    const partners: PortPoint[] = []
    for (const copy of [first, second]) {
      const pairs = copy.node.portPointsInPairs?.filter((ports) =>
        ports[0].portPointId === id || ports[1].portPointId === id)
      if (pairs?.length !== 1) break
      const [a, b] = pairs[0]
      const own = a.portPointId === id ? a : b
      const partner = a.portPointId === id ? b : a
      const represented = copy.node.portPoints.filter((candidate) =>
        partner.portPointId ? candidate.portPointId === partner.portPointId : candidate === partner)
      if (partner.z !== point.z || partner.portPointId === id ||
        own.pcb_port_id || own.z !== point.z || own.connectionName !== point.connectionName ||
        own.rootConnectionName !== point.rootConnectionName ||
        own.x !== copy.point.x || own.y !== copy.point.y ||
        ![partner.x, partner.y, partner.z].every(Number.isFinite) ||
        partner.connectionName !== point.connectionName ||
        partner.rootConnectionName !== point.rootConnectionName ||
        represented.length !== 1 || represented[0].x !== partner.x ||
        represented[0].y !== partner.y || represented[0].z !== partner.z ||
        represented[0].connectionName !== partner.connectionName ||
        represented[0].rootConnectionName !== partner.rootConnectionName ||
        represented[0].pcb_port_id !== partner.pcb_port_id) break
      partners.push(partner)
    }
    if (partners.length !== 2) continue
    stats.sameLayerPortCount++
    positions.set(id, { x: point.x, y: point.y })
    movable.push({ id, point, edge, owners: [first.node, second.node],
      partners: partners as [PortPoint, PortPoint] })
  }
  movable.sort((a, b) => a.id.localeCompare(b.id))
  const getObjective = (): number => {
    let total = 0
    for (const node of nodes) {
      for (const [a, b] of node.portPointsInPairs ?? []) {
        const start = a.portPointId ? positions.get(a.portPointId) ?? a : a
        const end = b.portPointId ? positions.get(b.portPointId) ?? b : b
        const length = Math.hypot(start.x - end.x, start.y - end.y)
        if (Number.isFinite(length)) total += length
      }
    }
    return total
  }
  stats.objectiveBefore = getObjective()
  const eligible = new Set<string>()
  const pitch = traceWidth + clearance
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    for (const port of movable) {
      const spacingInterval = getLegalInterval(port, positions, pitch)
      if (!spacingInterval) continue
      const interval = getClearSweptInterval(port, spacingInterval, positions,
        blockedByNode, srj, traceWidth / 2 + clearance, traceWidth / 2 + boardClearance)
      if (!interval) continue
      eligible.add(port.id)
      const vertical = port.edge.orientation === "vertical"
      const current = positions.get(port.id)!
      const score = (coordinate: number): number => {
        let total = 0
        const x = vertical ? current.x : coordinate
        const y = vertical ? coordinate : current.y
        for (const partner of port.partners) {
          const position = partner.portPointId ? positions.get(partner.portPointId) ?? partner : partner
          total += Math.hypot(x - position.x, y - position.y)
        }
        return total
      }
      let [lower, upper] = interval
      for (let step = 0; step < SEARCH_STEPS; step++) {
        const first = lower + (upper - lower) / 3
        const second = upper - (upper - lower) / 3
        if (score(first) <= score(second)) upper = second
        else lower = first
      }
      const coordinate = (lower + upper) / 2
      const previous = vertical ? current.y : current.x
      if (score(coordinate) >= score(previous) - EPSILON) continue
      positions.set(port.id, vertical ? { x: current.x, y: coordinate }
        : { x: coordinate, y: current.y })
      stats.acceptedMoveCount++
    }
  }
  stats.eligiblePortCount = eligible.size
  stats.movedPortCount = movable.filter((port) => {
    const position = positions.get(port.id)!
    return Math.hypot(position.x - port.point.x, position.y - port.point.y) > EPSILON
  }).length
  stats.objectiveAfter = getObjective()
  if (stats.objectiveAfter > stats.objectiveBefore + EPSILON) {
    throw new Error("Joint port coordinate optimization increased its routing objective")
  }
  const movePoint = (point: PortPoint): PortPoint => {
    if (!point.portPointId) return point
    const position = positions.get(point.portPointId)
    if (!position) return point
    if (point.x === position.x && point.y === position.y) return point
    return { ...point, x: position.x, y: position.y }
  }
  return { nodes: nodes.map((node) => ({ ...node,
    portPoints: node.portPoints.map(movePoint),
    ...(node.portPointsInPairs ? { portPointsInPairs: node.portPointsInPairs.map(
      ([a, b]): [PortPoint, PortPoint] => [movePoint(a), movePoint(b)]) } : {}),
  })), stats }
}
