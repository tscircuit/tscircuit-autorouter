import { clamp, pointToBoxDistance, pointToSegmentDistance, segmentToBoxMinDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { PortPoint } from "lib/types/high-density-types"
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
  boardGeometry?: HighDensityBoardGeometry
  coordinateScale: number
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
  const foreign: PreparedObstacle[] = context.obstacles
    .filter((obstacle) => !isObstacleConnectedToRoute(obstacle, identity, context.connMap))
    .map((obstacle) => {
      const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
      const cosine = Math.cos(angle)
      const sine = Math.sin(angle)
      const layers = obstacle.zLayers ?? obstacle.__zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, context.layerCount))
      const opaque = isOpaqueUnownedObstacle(obstacle)
      return { obstacle, cosine, sine, layers,
        viaMargin: params.viaDiameter / 2 + (opaque ? 0 : context.viaToPadClearance),
        traceMargin: params.traceThickness / 2 + (opaque ? 0 : context.traceToPadClearance) }
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
  const blocked = blockers(nominal)
  if (blocked.length === 0 && boardClear(nominal)) return params.nominal
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
  const legal = [...candidates.values()].filter((via) => boardClear(via) && blockers(via).length === 0)
    .map((via) => ({ via, length: Math.hypot(via.x - start.x, via.y - start.y) + Math.hypot(via.x - end.x, via.y - end.y) }))
  legal.sort((a, b) => a.length - b.length || a.via.x - b.via.x || a.via.y - b.via.y)
  const chosen = legal[0]?.via
  return chosen && { x: center.x + (chosen.x - center.x) * scale, y: center.y + (chosen.y - center.y) * scale }
}
