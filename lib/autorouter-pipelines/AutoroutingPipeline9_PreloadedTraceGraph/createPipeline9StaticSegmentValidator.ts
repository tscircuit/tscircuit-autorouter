import { pointToSegmentDistance, segmentToBoundsMinDistance, segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { SimpleRouteJson } from "lib/types"
import type { StaticSegmentValidator } from "lib/types/high-density-types"
import { isOpaqueUnownedObstacle } from "lib/utils/isOpaqueUnownedObstacle"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { doesSegmentCrossPolygonBoundary, isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import { getPipeline9PhysicalGeometryContext } from "./getPipeline9PhysicalGeometryContext"

type Point = { x: number; y: number }
type Shape = { kind: "rect" | "oval"; width: number; height: number }
type PreparedObstacle = {
  layers: Set<number>; owners: Set<string>
  x: number; y: number; cosine: number; sine: number
  engineShape?: Shape; rawShape?: Shape
  opaque: boolean; nonPlatedHole: boolean
}
const validators = new WeakMap<SimpleRouteJson, StaticSegmentValidator>()

const shapeDistance = (a: Point, b: Point, shape: Shape): number => {
  if (shape.kind === "rect") return segmentToBoundsMinDistance(a, b, { minX: -shape.width / 2, maxX: shape.width / 2, minY: -shape.height / 2, maxY: shape.height / 2 })
  const spine = Math.abs(shape.width - shape.height) / 2
  const dx = shape.width >= shape.height ? spine : 0
  const dy = shape.height > shape.width ? spine : 0
  return Math.max(0, segmentToSegmentMinDistance(a, b, { x: -dx, y: -dy }, { x: dx, y: dy }) - Math.min(shape.width, shape.height) / 2)
}

/** Query static copper without rebuilding a DRC engine for every search edge. */
export function createPipeline9StaticSegmentValidator(physicalSrj: SimpleRouteJson): StaticSegmentValidator {
  const cached = validators.get(physicalSrj)
  if (cached) return cached
  const context = getPipeline9PhysicalGeometryContext(physicalSrj)
  const { srj, connMap } = context
  const prepared = new Map<number, PreparedObstacle>()
  const traceClearance = srj.minTraceToPadEdgeClearance ?? 0.1
  const viaClearance = srj.minViaEdgeToPadEdgeClearance ?? srj.minPadEdgeToPadEdgeClearance ?? 0.1
  const maximumClearance = Math.max(traceClearance, viaClearance, srj.minTraceToHoleEdgeClearance ?? 0)
  const boardClearance = srj.minBoardEdgeClearance ?? 0
  const validator: StaticSegmentValidator = (segment) => {
    const { start, end } = segment
    mapZToLayerName(start.z, srj.layerCount)
    mapZToLayerName(end.z, srj.layerCount)
    const via = start.z !== end.z
    if (via && (start.x !== end.x || start.y !== end.y)) return false
    const radius = via ? segment.viaDiameter / 2 : Math.max(segment.traceThickness, srj.minTraceWidth) / 2
    if (![start.x, start.y, end.x, end.y, radius].every(Number.isFinite) || radius < 0) throw new Error("Physical segment validation requires finite copper geometry")
    const boardRadius = radius + boardClearance
    for (const point of [start, end]) {
      if (point.x - boardRadius < srj.bounds.minX || point.x + boardRadius > srj.bounds.maxX || point.y - boardRadius < srj.bounds.minY || point.y + boardRadius > srj.bounds.maxY) return false
      if (srj.outline && (!isPointInOrOnPolygon(point, srj.outline) || srj.outline.some((a, i) => pointToSegmentDistance(point, a, srj.outline![(i + 1) % srj.outline!.length]!) < boardRadius - 1e-6))) return false
    }
    if (srj.outline && doesSegmentCrossPolygonBoundary({ start, end, polygon: srj.outline, margin: boardRadius })) return false
    const minZ = via && !srj.allowBlindAndBuriedVias ? 0 : Math.min(start.z, end.z)
    const maxZ = via && !srj.allowBlindAndBuriedVias ? srj.layerCount - 1 : Math.max(start.z, end.z)
    const owner = connMap.getNetConnectedToId(segment.connectionName) ?? (segment.rootConnectionName && connMap.getNetConnectedToId(segment.rootConnectionName)) ?? segment.rootConnectionName ?? segment.connectionName
    const reach = radius + maximumClearance + 1e-6
    for (const id of context.index?.search(Math.min(start.x, end.x) - reach, Math.min(start.y, end.y) - reach, Math.max(start.x, end.x) + reach, Math.max(start.y, end.y) + reach) ?? []) {
      let obstacle = prepared.get(id)
      if (!obstacle) {
        const raw = context.obstacles[id]!
        const obstacleType = raw.type as string
        const angle = (raw.ccwRotationDegrees ?? 0) * Math.PI / 180
        if (!Number.isFinite(angle)) throw new Error("Physical segment validation requires finite obstacle rotation")
        const recognized = raw.connectedTo.some((name) => /^(pcb_smtpad_|pcb_plated_hole_|pcb_port_)/.test(name))
        const squarePlated = obstacleType === "rect" && raw.layers.length > 1 && Math.abs(raw.width - raw.height) < 0.001
        const needsRaw = !recognized || Math.abs((raw.ccwRotationDegrees ?? 0) % 180) > 1e-8 || squarePlated
        if (obstacleType !== "rect" && obstacleType !== "oval") throw new Error("Physical segment validation found an unsupported obstacle shape")
        const rawCircle = raw.isNonPlatedHole && raw.shape === "circle"
        const engineCircle = raw.ccwRotationDegrees === undefined && raw.layers.length > 1 && Math.abs(raw.width - raw.height) < 0.001
        obstacle = {
          layers: new Set(raw.__zLayers), owners: new Set(raw.connectedTo.map((name) => connMap.getNetConnectedToId(name) ?? name)),
          x: raw.center.x, y: raw.center.y, cosine: Math.cos(angle), sine: Math.sin(angle),
          engineShape: recognized ? { kind: engineCircle ? "oval" : "rect", width: raw.width, height: engineCircle ? raw.width : raw.height } : undefined,
          rawShape: needsRaw ? { kind: rawCircle || obstacleType === "oval" ? "oval" : "rect", width: raw.width, height: rawCircle ? raw.width : raw.height } : undefined,
          opaque: isOpaqueUnownedObstacle(raw), nonPlatedHole: raw.isNonPlatedHole === true,
        }
        prepared.set(id, obstacle)
      }
      if (obstacle.owners.has(owner) || ![...obstacle.layers].some((z) => z >= minZ && z <= maxZ)) continue
      const local = (point: Point): Point => ({ x: (point.x - obstacle!.x) * obstacle!.cosine + (point.y - obstacle!.y) * obstacle!.sine, y: -(point.x - obstacle!.x) * obstacle!.sine + (point.y - obstacle!.y) * obstacle!.cosine })
      const a = local(start), b = local(end)
      const clearance = via ? viaClearance : traceClearance
      if (obstacle.engineShape && shapeDistance(a, b, obstacle.engineShape) - radius + 0.005 < clearance) return false
      const rawClearance = obstacle.opaque ? 0 : !via && obstacle.nonPlatedHole ? srj.minTraceToHoleEdgeClearance ?? traceClearance : clearance
      if (obstacle.rawShape && shapeDistance(a, b, obstacle.rawShape) - radius + 1e-8 < rawClearance) return false
    }
    return true
  }
  validators.set(physicalSrj, validator)
  return validator
}
