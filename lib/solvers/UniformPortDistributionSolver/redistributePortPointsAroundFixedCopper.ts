import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getPipeline9RouteCopperGeometry } from "../../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { PortPointWithOwnerPair, SharedEdge } from "./types"

export type FixedCopperPortConstraints = {
  routes: HighDensityRoute[]
  connMap: ConnectivityMap
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  traceWidth: number
  clearance: number
}

type Interval = { min: number; max: number }
type Point = { x: number; y: number }
const EPSILON = 1e-6

// Intersect an axis-aligned boundary with a capsule, including its round ends.
// The rectangular body is the intersection of two linear inequalities.
const getCapsuleInterval = (
  edge: SharedEdge,
  start: Point,
  end: Point,
  radius: number,
): Interval | undefined => {
  const horizontal = edge.orientation === "horizontal"
  const a = horizontal ? start.x : start.y
  const b = horizontal ? end.x : end.y
  const v = horizontal ? start.y : start.x
  const w = horizontal ? end.y : end.x
  const fixed = horizontal ? edge.y1 : edge.x1
  const du = b - a
  const dv = w - v
  const lengthSquared = du * du + dv * dv
  const intervals: Interval[] = []
  for (const [u, other] of [[a, v], [b, w]]) {
    const squaredSpan = radius * radius - (fixed - other!) ** 2
    if (squaredSpan >= 0) {
      const span = Math.sqrt(squaredSpan)
      intervals.push({ min: u! - span, max: u! + span })
    }
  }
  if (lengthSquared > EPSILON * EPSILON) {
    let min = -Infinity
    let max = Infinity
    for (const [coefficient, offset, lower, upper] of [
      [du, (fixed - v) * dv - a * du, 0, lengthSquared],
      [dv, -(fixed - v) * du - a * dv,
        -radius * Math.sqrt(lengthSquared), radius * Math.sqrt(lengthSquared)],
    ]) {
      if (Math.abs(coefficient!) < 1e-12) {
        if (offset! < lower! || offset! > upper!) {
          min = Infinity
          max = -Infinity
          break
        }
      } else {
        const first = (lower! - offset!) / coefficient!
        const second = (upper! - offset!) / coefficient!
        min = Math.max(min, Math.min(first, second))
        max = Math.min(max, Math.max(first, second))
      }
    }
    if (min <= max) intervals.push({ min, max })
  }
  if (intervals.length === 0) return undefined
  return {
    min: Math.min(...intervals.map((interval) => interval.min)),
    max: Math.max(...intervals.map((interval) => interval.max)),
  }
}

/** Space crossings in the free part of each boundary, rather than on copper. */
export const redistributePortPointsAroundFixedCopper = ({
  sharedEdge,
  portPoints,
  originalPortPoints,
  constraints,
}: {
  sharedEdge: SharedEdge
  portPoints: PortPointWithOwnerPair[]
  originalPortPoints: PortPointWithOwnerPair[]
  constraints: FixedCopperPortConstraints
}): PortPointWithOwnerPair[] => {
  const horizontal = sharedEdge.orientation === "horizontal"
  const edgeMin = horizontal ? sharedEdge.x1 : sharedEdge.y1
  const edgeMax = horizontal ? sharedEdge.x2 : sharedEdge.y2
  return portPoints.map((port) => {
    const rootConnectionName = port.rootConnectionName ?? port.connectionName
    const blocked: Interval[] = []
    for (const route of constraints.routes) {
      if ([route.connectionName, route.rootConnectionName].some((id) =>
        id && (id === rootConnectionName ||
          constraints.connMap.areIdsConnected(id, rootConnectionName)),
      )) continue
      const geometry = getPipeline9RouteCopperGeometry(route, constraints)
      for (const segment of geometry.wireSegments) {
        if (segment.z !== port.z) continue
        const interval = getCapsuleInterval(sharedEdge, segment.start, segment.end,
          (segment.width + constraints.traceWidth) / 2 + constraints.clearance)
        if (interval) blocked.push(interval)
      }
      for (const via of geometry.viaSpans) {
        if (port.z < via.minZ || port.z > via.maxZ) continue
        const interval = getCapsuleInterval(sharedEdge, via.center, via.center,
          (via.diameter + constraints.traceWidth) / 2 + constraints.clearance)
        if (interval) blocked.push(interval)
      }
    }
    const coordinate = horizontal ? port.x : port.y
    if (!blocked.some((interval) => coordinate >= interval.min - EPSILON &&
      coordinate <= interval.max + EPSILON)) return port
    const peers = portPoints.filter((peer) => peer === port || (peer.z === port.z &&
      (peer.rootConnectionName ?? peer.connectionName) !== rootConnectionName &&
      !constraints.connMap.areIdsConnected(peer.rootConnectionName ?? peer.connectionName,
        rootConnectionName)))
      .sort((a, b) => horizontal ? a.x - b.x : a.y - b.y)
    const index = peers.indexOf(port)
    const previous = peers[index - 1]
    const next = peers[index + 1]
    const spacing = constraints.traceWidth + constraints.clearance
    let free: Interval[] = [{
      min: previous
        ? ((horizontal ? previous.x : previous.y) + coordinate + spacing) / 2
        : edgeMin,
      max: next
        ? ((horizontal ? next.x : next.y) + coordinate - spacing) / 2
        : edgeMax,
    }].filter((span) => span.max > span.min)
    for (const interval of blocked) {
      free = free.flatMap((span) => {
        if (interval.max < span.min || interval.min > span.max) return [span]
        const pieces: Interval[] = []
        if (interval.min - EPSILON > span.min) {
          pieces.push({ min: span.min, max: interval.min - EPSILON })
        }
        if (interval.max + EPSILON < span.max) {
          pieces.push({ min: interval.max + EPSILON, max: span.max })
        }
        return pieces
      })
    }
    if (free.length === 0) {
      throw new Error(`No copper-clear boundary crossing for "${port.connectionName}"`)
    }
    const original = originalPortPoints.find((point) =>
      point.portPointId === port.portPointId,
    )
    if (!original) {
      throw new Error(`Missing original boundary crossing for "${port.connectionName}"`)
    }
    const preferred = horizontal ? original.x : original.y
    free.sort((a, b) => Math.abs((a.min + a.max) / 2 - preferred) -
      Math.abs((b.min + b.max) / 2 - preferred))
    const position = (free[0]!.min + free[0]!.max) / 2
    return horizontal ? { ...port, x: position } : { ...port, y: position }
  })
}
