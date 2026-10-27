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
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { queryMandatoryPortPointIndex, type MandatoryPortPointIndex } from "./mandatoryPortPointIndex"
import { areCopperRoutesOnSameNet as sameElectricalNet } from "./completedCopperWorldIndex"

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
  routedPeerRoutes?: readonly HighDensityIntraNodeRoute[]
  mandatoryPortPoints?: readonly PortPoint[]
  /** All cohort endpoints in WORLD coordinates, also during grow/shrink. */
  mandatoryPortPointIndex?: MandatoryPortPointIndex
  viaHoleDiameter?: number
  minViaHoleEdgeToViaHoleEdgeClearance?: number
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
type PeerWire = { start: Point; end: Point; z: number; radius: number }
type PeerVia = { center: Point; minZ: number; maxZ: number; radius: number; holeRadius: number }
const EPSILON = 1e-9
// Independent of via-to-pad rules; matches getDrcErrors.MIN_VIA_TO_VIA_CLEARANCE.
const MINIMUM_VIA_EDGE_CLEARANCE = 0.1

/** Final admission for every candidate family, including regional optimizers. */
export const areRoutesClearOfMandatoryPorts = (params: {
  routes: readonly HighDensityIntraNodeRoute[]
  context: SingleTransitionBoardContext
  center: Point
  traceThickness: number
  viaDiameter: number
}): boolean => {
  const { context, center } = params, index = context.mandatoryPortPointIndex
  if (!index) return true
  const scale = context.coordinateScale
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid transition coordinate scale")
  const world = (p: Point): Point => ({ x: center.x + (p.x - center.x) / scale, y: center.y + (p.y - center.y) / scale })
  for (const route of params.routes) {
    const geometry = getPipeline9RouteCopperGeometry(route, context)
    for (const wire of geometry.wireSegments) {
      const a = world(wire.start), b = world(wire.end)
      const margin = wire.width / 2 + params.traceThickness / 2 + context.traceToPadClearance
      const points = queryMandatoryPortPointIndex(index, { minX: Math.min(a.x, b.x) - margin,
        maxX: Math.max(a.x, b.x) + margin, minY: Math.min(a.y, b.y) - margin, maxY: Math.max(a.y, b.y) + margin })
      if (points.some((point) => point.z === wire.z && !sameElectricalNet(route, point, context.connMap) &&
        pointToSegmentDistance(point, a, b) + EPSILON < margin)) return false
    }
    for (const via of geometry.viaSpans) {
      const point = world(via.center), margin = Math.max(via.diameter, params.viaDiameter) / 2 +
        params.traceThickness / 2 + context.traceToPadClearance
      const minZ = context.allowBlindAndBuriedVias ? via.minZ : 0
      const maxZ = context.allowBlindAndBuriedVias ? via.maxZ : context.layerCount - 1
      const points = queryMandatoryPortPointIndex(index, { minX: point.x - margin, maxX: point.x + margin,
        minY: point.y - margin, maxY: point.y + margin })
      if (points.some((p) => p.z >= minZ && p.z <= maxZ && !sameElectricalNet(route, p, context.connMap) &&
        Math.hypot(p.x - point.x, p.y - point.y) + EPSILON < margin)) return false
    }
  }
  return true
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
      for (const peer of context.routedPeerRoutes ?? []) {
        if (sameElectricalNet(route, peer, context.connMap)) continue
        const geometry = getPipeline9RouteCopperGeometry(peer, context)
        for (const wire of geometry.wireSegments) {
          if (wire.z === start.z && minimumDistanceBetweenSegments(a, b, world(wire.start), world(wire.end)) + EPSILON < radius + wire.width / 2 + context.traceToPadClearance) return false
        }
        for (const via of geometry.viaSpans) {
          const minZ = context.allowBlindAndBuriedVias ? via.minZ : 0
          const maxZ = context.allowBlindAndBuriedVias ? via.maxZ : context.layerCount - 1
          if (start.z >= minZ && start.z <= maxZ && pointToSegmentDistance(world(via.center), a, b) + EPSILON < radius + via.diameter / 2 + context.traceToPadClearance) return false
        }
      }
      for (const point of context.mandatoryPortPoints ?? []) {
        if (point.z !== start.z || sameElectricalNet(route, point, context.connMap)) continue
        if (pointToSegmentDistance(world(point), a, b) + EPSILON < radius * 2 + context.traceToPadClearance) return false
      }
      if (context.mandatoryPortPointIndex) {
        const margin = radius * 2 + context.traceToPadClearance
        const points = queryMandatoryPortPointIndex(context.mandatoryPortPointIndex, {
          minX: Math.min(a.x, b.x) - margin, maxX: Math.max(a.x, b.x) + margin,
          minY: Math.min(a.y, b.y) - margin, maxY: Math.max(a.y, b.y) + margin,
        })
        for (const point of points) {
          if (point.z === start.z && !sameElectricalNet(route, point, context.connMap) &&
            pointToSegmentDistance(point, a, b) + EPSILON < margin) return false
        }
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
  for (const route of context.planarRoutes ?? []) {
    if (route.vias.length > 0 || route.route.some((p, i) => i > 0 && p.z !== route.route[i - 1]!.z)) {
      throw new Error("Transition peer must be planar copper")
    }
  }
  const peers: PeerWire[] = [], peerVias: PeerVia[] = []
  for (const route of [...(context.planarRoutes ?? []), ...(context.routedPeerRoutes ?? [])]) {
    if (sameElectricalNet(identity, route, context.connMap)) continue
    const geometry = getPipeline9RouteCopperGeometry(route, context)
    for (const wire of geometry.wireSegments) {
      peers.push({ start: toWorld(wire.start), end: toWorld(wire.end), z: wire.z, radius: wire.width / 2 })
    }
    for (const via of geometry.viaSpans) {
      peerVias.push({ center: toWorld(via.center), radius: via.diameter / 2,
        holeRadius: (context.viaHoleDiameter ?? via.diameter) / 2,
        minZ: context.allowBlindAndBuriedVias ? via.minZ : 0,
        maxZ: context.allowBlindAndBuriedVias ? via.maxZ : context.layerCount - 1 })
    }
  }
  const terminals = (context.mandatoryPortPoints ?? [])
    .filter((point) => !sameElectricalNet(identity, point, context.connMap))
    .map((point) => ({ ...toWorld(point), z: point.z }))
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
  const indexedTerminals = (via: Point): readonly PortPoint[] => {
    if (!context.mandatoryPortPointIndex) return []
    const margin = Math.max(viaRadius + traceRadius, traceRadius * 2) + context.traceToPadClearance
    return queryMandatoryPortPointIndex(context.mandatoryPortPointIndex, {
      minX: Math.min(start.x, end.x, via.x) - margin, maxX: Math.max(start.x, end.x, via.x) + margin,
      minY: Math.min(start.y, end.y, via.y) - margin, maxY: Math.max(start.y, end.y, via.y) + margin,
    }).filter((point) => !sameElectricalNet(identity, point, context.connMap))
  }
  const viaPeerMargin = (peer: PeerVia): number => {
    const annulusMargin = viaRadius + peer.radius + MINIMUM_VIA_EDGE_CLEARANCE
    const drillMargin = (context.viaHoleDiameter ?? params.viaDiameter) / 2 + peer.holeRadius +
      (context.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1)
    return Math.max(annulusMargin, drillMargin)
  }
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
  const terminalClear = (via: Point, point: Point & { z: number }): boolean => {
    if (point.z >= minZ && point.z <= maxZ && Math.hypot(via.x - point.x, via.y - point.y) + EPSILON < viaRadius + traceRadius + context.traceToPadClearance) return false
    const margin = traceRadius * 2 + context.traceToPadClearance
    if (point.z === params.start.z && pointToSegmentDistance(point, start, via) + EPSILON < margin) return false
    if (point.z === params.end.z && pointToSegmentDistance(point, end, via) + EPSILON < margin) return false
    return true
  }
  const peerClear = (via: Point): boolean => {
    for (const peer of peers) {
      if (peer.z >= minZ && peer.z <= maxZ && pointToSegmentDistance(via, peer.start, peer.end) + EPSILON < viaRadius + peer.radius + context.traceToPadClearance) return false
      const wireMargin = traceRadius + peer.radius + context.traceToPadClearance
      if (peer.z === params.start.z && minimumDistanceBetweenSegments(start, via, peer.start, peer.end) + EPSILON < wireMargin) return false
      if (peer.z === params.end.z && minimumDistanceBetweenSegments(end, via, peer.start, peer.end) + EPSILON < wireMargin) return false
    }
    for (const peer of peerVias) {
      if (peer.minZ <= maxZ && peer.maxZ >= minZ && Math.hypot(via.x - peer.center.x, via.y - peer.center.y) + EPSILON < viaPeerMargin(peer)) return false
      const margin = traceRadius + peer.radius + context.traceToPadClearance
      if (params.start.z >= peer.minZ && params.start.z <= peer.maxZ && pointToSegmentDistance(peer.center, start, via) + EPSILON < margin) return false
      if (params.end.z >= peer.minZ && params.end.z <= peer.maxZ && pointToSegmentDistance(peer.center, end, via) + EPSILON < margin) return false
    }
    for (const point of terminals) if (!terminalClear(via, point)) return false
    for (const point of indexedTerminals(via)) if (!terminalClear(via, point)) return false
    return true
  }
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
  const circles = [
    ...peerVias.filter((peer) => peer.minZ <= maxZ && peer.maxZ >= minZ)
      .map((peer) => ({ center: peer.center, margin: viaPeerMargin(peer) + 1e-6 })),
    ...terminals.filter((point) => point.z >= minZ && point.z <= maxZ)
      .map((point) => ({ center: point, margin: viaRadius + traceRadius + context.traceToPadClearance + 1e-6 })),
  ]
  const appendCircleCandidates = (circle: { center: Point; margin: number }): void => {
    const { center: point, margin } = circle
    for (const direction of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const p = { x: point.x + direction.x * margin, y: point.y + direction.y * margin }
      candidates.set(`${p.x},${p.y}`, p)
    }
    for (const query of [nominal, start, end]) {
      const dx = query.x - point.x, dy = query.y - point.y, distance = Math.hypot(dx, dy)
      if (distance <= EPSILON) continue
      const p = { x: point.x + dx / distance * margin, y: point.y + dy / distance * margin }
      candidates.set(`${p.x},${p.y}`, p)
    }
  }
  for (const circle of circles) appendCircleCandidates(circle)
  // Include fixed copper encountered anywhere along a proposed leg, rather
  // than limiting the constraint to the original cell or nominal via.
  const blockingPoints = new Map<string, PortPoint>()
  for (const via of [nominal, ...candidates.values()]) {
    for (const point of indexedTerminals(via)) {
      if (!terminalClear(via, point)) blockingPoints.set(`${point.x},${point.y},${point.z}`, point)
    }
  }
  for (const point of blockingPoints.values()) {
    appendCircleCandidates({ center: point, margin: viaRadius + traceRadius + context.traceToPadClearance + 1e-6 })
  }
  const isClear = (via: Point): boolean => boardClear(via) && blockers(via).length === 0 && peerClear(via)
  const legal = [...candidates.values()].filter(isClear)
    .map((via) => ({ via, length: Math.hypot(via.x - start.x, via.y - start.y) + Math.hypot(via.x - end.x, via.y - end.y) }))
  if (legal.length === 0) {
    // A gap can require one obstacle's X boundary and another's Y boundary.
    // Complete these finite clearance events before declaring no proposal.
    const xs = new Set([...candidates.values()].map((point) => point.x))
    const ys = new Set([...candidates.values()].map((point) => point.y))
    for (const x of xs) for (const y of ys) {
      if (candidates.has(`${x},${y}`)) continue
      const via = { x, y }
      if (!isClear(via)) continue
      legal.push({ via, length: Math.hypot(x - start.x, y - start.y) + Math.hypot(x - end.x, y - end.y) })
    }
  }
  legal.sort((a, b) => a.length - b.length || a.via.x - b.via.x || a.via.y - b.via.y)
  const chosen = legal[0]?.via
  return chosen && { x: center.x + (chosen.x - center.x) * scale, y: center.y + (chosen.y - center.y) * scale }
}
