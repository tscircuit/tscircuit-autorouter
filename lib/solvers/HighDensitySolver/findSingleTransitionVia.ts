import { clamp, pointToBoxDistance, pointToSegmentDistance, segmentToBoxMinDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityIntraNodeRoute, PortPoint } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import { isOpaqueUnownedObstacle } from "lib/utils/isOpaqueUnownedObstacle"

type Point = { x: number; y: number }
export type SingleTransitionBoardContext = {
  obstacles: Obstacle[]
  connMap?: ConnectivityMap
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  viaToPadClearance: number
  traceToPadClearance: number
  traceToHoleClearance?: number
  boardGeometry?: HighDensityBoardGeometry
  coordinateScale: number
  /** Complete planar copper that a new through barrel and wire legs must clear. */
  planarRoutes?: readonly HighDensityIntraNodeRoute[]
}
type Input = {
  nominal: Point
  start: PortPoint
  end: PortPoint
  connectionName: string
  center: Point
  viaDiameter: number
  traceThickness: number
  context: SingleTransitionBoardContext
}
type PreparedObstacle = { obstacle: Obstacle; layers: number[]; cosine: number; sine: number; viaMargin: number; traceMargin: number }
const EPSILON = 1e-9

const sameElectricalNet = (a: Pick<HighDensityIntraNodeRoute, "connectionName" | "rootConnectionName">,
  b: Pick<HighDensityIntraNodeRoute, "connectionName" | "rootConnectionName">, connMap?: ConnectivityMap): boolean => {
  const canonical = new Set(Object.keys(connMap?.netMap ?? {}))
  const owner = (route: typeof a): string => {
    if (route.rootConnectionName !== undefined && canonical.has(route.rootConnectionName)) {
      return JSON.stringify(["registered", route.rootConnectionName])
    }
    if (canonical.has(route.connectionName)) return JSON.stringify(["registered", route.connectionName])
    const registered = connMap?.getNetConnectedToId(route.connectionName)
    if (registered !== undefined) return JSON.stringify(["registered", registered])
    const root = route.rootConnectionName ?? route.connectionName
    const net = canonical.has(root) ? root : connMap?.getNetConnectedToId(root)
    return JSON.stringify(net === undefined ? ["literal", root] : ["registered", net])
  }
  return owner(a) === owner(b)
}

/** Certifies the fixed planar part before using it as a peer obstacle. */
export const areSingleTransitionPlanarRoutesClear = (params: {
  routes: readonly HighDensityIntraNodeRoute[]
  context: SingleTransitionBoardContext
  center: Point
}): boolean => {
  const { routes, context, center } = params
  const scale = context.coordinateScale
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid transition coordinate scale")
  const world = (p: Point): Point => ({ x: center.x + (p.x - center.x) / scale, y: center.y + (p.y - center.y) / scale })
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i]!, radius = route.traceThickness / 2
    if (route.vias.length > 0) return false
    for (let j = 1; j < route.route.length; j++) {
      const start = route.route[j - 1]!, end = route.route[j]!
      if (start.z !== end.z) return false
      const a = world(start), b = world(end), board = context.boardGeometry
      if (board) {
        const margin = radius + (board.minBoardEdgeClearance ?? 0)
        if ([a, b].some((p) => p.x < board.bounds.minX + margin - EPSILON || p.x > board.bounds.maxX - margin + EPSILON ||
          p.y < board.bounds.minY + margin - EPSILON || p.y > board.bounds.maxY - margin + EPSILON)) return false
        if (board.outline?.length) {
          if (![a, b].every((p) => isPointInOrOnPolygon(p, board.outline!))) return false
          for (let k = 0; k < board.outline.length; k++) {
            if (minimumDistanceBetweenSegments(a, b, board.outline[k]!, board.outline[(k + 1) % board.outline.length]!) + EPSILON < margin) return false
          }
        }
      }
      for (const obstacle of context.obstacles) {
        if (isObstacleConnectedToRoute(obstacle, route, context.connMap)) continue
        const layers = obstacle.zLayers ?? obstacle.__zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, context.layerCount))
        if (!layers.includes(start.z)) continue
        const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
        const clearance = isOpaqueUnownedObstacle(obstacle) ? 0 : obstacle.isNonPlatedHole
          ? context.traceToHoleClearance ?? context.traceToPadClearance : context.traceToPadClearance
        const prepared = { obstacle, layers, cosine: Math.cos(angle), sine: Math.sin(angle), viaMargin: 0, traceMargin: radius + clearance }
        if (obstacleDistance(a, b, prepared) + EPSILON < prepared.traceMargin) return false
      }
      for (let k = 0; k < i; k++) {
        const peer = routes[k]!
        if (sameElectricalNet(route, peer, context.connMap)) continue
        for (let l = 1; l < peer.route.length; l++) {
          const c = peer.route[l - 1]!, d = peer.route[l]!
          if (c.z !== start.z) continue
          if (minimumDistanceBetweenSegments(a, b, world(c), world(d)) + EPSILON < radius + peer.traceThickness / 2 + context.traceToPadClearance) return false
        }
      }
    }
  }
  return true
}

const toLocal = (point: Point, prepared: PreparedObstacle): Point => {
  const dx = point.x - prepared.obstacle.center.x
  const dy = point.y - prepared.obstacle.center.y
  const x = dx * prepared.cosine + dy * prepared.sine
  const y = -dx * prepared.sine + dy * prepared.cosine
  return { x, y }
}

const obstacleDistance = (start: Point, end: Point, prepared: PreparedObstacle): number => {
  const obstacle = prepared.obstacle
  if (obstacle.shape === "circle") {
    return Math.max(0, pointToSegmentDistance(obstacle.center, start, end) - obstacle.width / 2)
  }
  const a = toLocal(start, prepared), b = toLocal(end, prepared)
  const box = { center: { x: 0, y: 0 }, width: obstacle.width, height: obstacle.height }
  return start === end ? pointToBoxDistance(a, box) : segmentToBoxMinDistance(a, b, box)
}

/** A finite geometric proposal search, preserving an already legal nominal via. */
export const findSingleTransitionVia = (params: Input): Point | undefined => {
  const { context, center } = params
  const scale = context.coordinateScale
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid transition coordinate scale")
  const toWorld = (point: Point): Point => {
    const offsetX = (point.x - center.x) / scale
    const offsetY = (point.y - center.y) / scale
    const x = center.x + offsetX
    const y = center.y + offsetY
    return { x, y }
  }
  const start = toWorld(params.start), end = toWorld(params.end)
  const nominal = toWorld(params.nominal)
  const identity = { connectionName: params.connectionName, rootConnectionName: params.start.rootConnectionName ?? params.end.rootConnectionName }
  const peers = (context.planarRoutes ?? []).filter((route) => !sameElectricalNet(identity, route, context.connMap))
    .flatMap((route) => route.route.slice(1).map((end, index) => {
      const start = route.route[index]!
      if (start.z !== end.z || route.vias.length > 0) throw new Error("Transition peer must be planar copper")
      return { start: toWorld(start), end: toWorld(end), z: start.z, radius: route.traceThickness / 2 }
    }))
  const foreign: PreparedObstacle[] = context.obstacles
    .filter((obstacle) => !isObstacleConnectedToRoute(obstacle, identity, context.connMap))
    .map((obstacle) => {
      const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
      const cosine = Math.cos(angle)
      const sine = Math.sin(angle)
      const layers = obstacle.zLayers ?? obstacle.__zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, context.layerCount))
      const opaque = isOpaqueUnownedObstacle(obstacle)
      const traceClearance = obstacle.isNonPlatedHole
        ? context.traceToHoleClearance ?? context.traceToPadClearance
        : context.traceToPadClearance
      return { obstacle, cosine, sine, layers,
        viaMargin: params.viaDiameter / 2 + (opaque ? 0 : context.viaToPadClearance),
        traceMargin: params.traceThickness / 2 + (opaque ? 0 : traceClearance) }
    })
  const minZ = context.allowBlindAndBuriedVias ? Math.min(params.start.z!, params.end.z!) : 0
  const maxZ = context.allowBlindAndBuriedVias ? Math.max(params.start.z!, params.end.z!) : context.layerCount - 1
  const viaRadius = params.viaDiameter / 2, traceRadius = params.traceThickness / 2
  const board = context.boardGeometry
  const boardClear = (via: Point): boolean => {
    if (!board) return true
    const edge = board.minBoardEdgeClearance ?? 0
    const inset = (point: Point, radius: number): boolean => {
      const margin = radius + edge
      const minX = board.bounds.minX + margin, maxX = board.bounds.maxX - margin
      const minY = board.bounds.minY + margin, maxY = board.bounds.maxY - margin
      return point.x >= minX - EPSILON && point.x <= maxX + EPSILON &&
        point.y >= minY - EPSILON && point.y <= maxY + EPSILON
    }
    if (!inset(via, viaRadius) || !inset(start, traceRadius) || !inset(end, traceRadius)) return false
    const outline = board.outline
    if (!outline?.length) return true
    if (![start, end, via].every((point) => isPointInOrOnPolygon(point, outline))) return false
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]!, b = outline[(i + 1) % outline.length]!
      if (pointToSegmentDistance(via, a, b) + EPSILON < viaRadius + edge ||
        minimumDistanceBetweenSegments(start, via, a, b) + EPSILON < traceRadius + edge ||
        minimumDistanceBetweenSegments(end, via, a, b) + EPSILON < traceRadius + edge) return false
    }
    return true
  }
  const blockers = (via: Point): PreparedObstacle[] => {
    const result: PreparedObstacle[] = []
    for (const prepared of foreign) {
      const blockedVia = prepared.layers.some((z) => z >= minZ && z <= maxZ) && obstacleDistance(via, via, prepared) + EPSILON < prepared.viaMargin
      const blockedStartWire = prepared.layers.includes(params.start.z!) && obstacleDistance(start, via, prepared) + EPSILON < prepared.traceMargin
      const blockedEndWire = prepared.layers.includes(params.end.z!) && obstacleDistance(end, via, prepared) + EPSILON < prepared.traceMargin
      if (blockedVia || blockedStartWire || blockedEndWire) result.push(prepared)
    }
    return result
  }
  const peerClear = (via: Point): boolean => peers.every((peer) => {
    if (peer.z >= minZ && peer.z <= maxZ && pointToSegmentDistance(via, peer.start, peer.end) + EPSILON < viaRadius + peer.radius + context.traceToPadClearance) return false
    const wireMargin = traceRadius + peer.radius + context.traceToPadClearance
    if (peer.z === params.start.z && minimumDistanceBetweenSegments(start, via, peer.start, peer.end) + EPSILON < wireMargin) return false
    if (peer.z === params.end.z && minimumDistanceBetweenSegments(end, via, peer.start, peer.end) + EPSILON < wireMargin) return false
    return true
  })
  const blocked = blockers(nominal)
  if (blocked.length === 0 && boardClear(nominal) && peerClear(nominal)) return params.nominal
  const candidates = new Map<string, Point>()
  for (const prepared of blocked) {
    const obstacle = prepared.obstacle
    const halfX = obstacle.width / 2 + prepared.viaMargin + 1e-6
    const halfY = obstacle.height / 2 + prepared.viaMargin + 1e-6
    const localCandidates: Point[] = []
    for (const point of [nominal, start, end]) {
      const local = toLocal(point, prepared)
      localCandidates.push(
        { x: clamp(local.x, -halfX, halfX), y: -halfY },
        { x: clamp(local.x, -halfX, halfX), y: halfY },
        { x: -halfX, y: clamp(local.y, -halfY, halfY) },
        { x: halfX, y: clamp(local.y, -halfY, halfY) },
      )
    }
    for (const x of [-halfX, halfX]) for (const y of [-halfY, halfY]) localCandidates.push({ x, y })
    for (const point of localCandidates) {
      const world = { x: obstacle.center.x + point.x * prepared.cosine - point.y * prepared.sine,
        y: obstacle.center.y + point.x * prepared.sine + point.y * prepared.cosine }
      candidates.set(`${world.x},${world.y}`, world)
    }
  }
  for (const peer of peers) {
    if (peer.z < minZ || peer.z > maxZ) continue
    const dx = peer.end.x - peer.start.x, dy = peer.end.y - peer.start.y
    const length = Math.hypot(dx, dy), ux = length > EPSILON ? dx / length : 1, uy = length > EPSILON ? dy / length : 0
    const margin = viaRadius + peer.radius + context.traceToPadClearance + 1e-6
    const points: Point[] = []
    for (const query of [nominal, start, end]) {
      const t = clamp((query.x - peer.start.x) * ux + (query.y - peer.start.y) * uy, 0, length)
      const base = { x: peer.start.x + t * ux, y: peer.start.y + t * uy }
      points.push({ x: base.x - uy * margin, y: base.y + ux * margin }, { x: base.x + uy * margin, y: base.y - ux * margin })
    }
    for (const endpoint of [peer.start, peer.end]) {
      for (const direction of [{ x: ux, y: uy }, { x: -ux, y: -uy }, { x: -uy, y: ux }, { x: uy, y: -ux }]) {
        points.push({ x: endpoint.x + direction.x * margin, y: endpoint.y + direction.y * margin })
      }
      for (const query of [nominal, start, end]) {
        const qx = query.x - endpoint.x, qy = query.y - endpoint.y, distance = Math.hypot(qx, qy)
        if (distance > EPSILON) points.push({ x: endpoint.x + qx / distance * margin, y: endpoint.y + qy / distance * margin })
      }
    }
    for (const point of points) candidates.set(`${point.x},${point.y}`, point)
  }
  const legal = [...candidates.values()].filter((via) => boardClear(via) && blockers(via).length === 0 && peerClear(via))
    .map((via) => ({ via, length: Math.hypot(via.x - start.x, via.y - start.y) + Math.hypot(via.x - end.x, via.y - end.y) }))
  legal.sort((a, b) => a.length - b.length || a.via.x - b.via.x || a.via.y - b.via.y)
  const chosen = legal[0]?.via
  return chosen && { x: center.x + (chosen.x - center.x) * scale, y: center.y + (chosen.y - center.y) * scale }
}
