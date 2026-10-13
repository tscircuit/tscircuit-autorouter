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
  for (const [u, other] of [
    [a, v],
    [b, w],
  ]) {
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
      [
        dv,
        -(fixed - v) * du - a * dv,
        -radius * Math.sqrt(lengthSquared),
        radius * Math.sqrt(lengthSquared),
      ],
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
  const placed: PortPointWithOwnerPair[] = []
  const originals = new Map(
    originalPortPoints.map((point) => [point.portPointId, point]),
  )
  const ordered = [...portPoints].sort((a, b) => {
    const originalA = originals.get(a.portPointId)
    const originalB = originals.get(b.portPointId)
    if (!originalA || !originalB) {
      throw new Error("Missing original boundary crossing")
    }
    return (
      (horizontal ? originalA.x - originalB.x : originalA.y - originalB.y) ||
      (horizontal ? a.x - b.x : a.y - b.y)
    )
  })
  let admissible = true
  let hasBlockedCrossing = false
  const proposal = ordered.map((port) => {
    const original = originalPortPoints.find(
      (point) => point.portPointId === port.portPointId,
    )
    if (!original) {
      throw new Error(
        `Missing original boundary crossing for "${port.connectionName}"`,
      )
    }
    const rootConnectionName = port.rootConnectionName ?? port.connectionName
    const blocked: Interval[] = []
    for (const route of constraints.routes) {
      if (
        [route.connectionName, route.rootConnectionName].some(
          (id) =>
            id &&
            (id === rootConnectionName ||
              constraints.connMap.areIdsConnected(id, rootConnectionName)),
        )
      )
        continue
      const geometry = getPipeline9RouteCopperGeometry(route, constraints)
      for (const segment of geometry.wireSegments) {
        if (segment.z !== port.z) continue
        const interval = getCapsuleInterval(
          sharedEdge,
          segment.start,
          segment.end,
          (segment.width + constraints.traceWidth) / 2 + constraints.clearance,
        )
        if (interval) blocked.push(interval)
      }
      for (const via of geometry.viaSpans) {
        if (port.z < via.minZ || port.z > via.maxZ) continue
        const interval = getCapsuleInterval(
          sharedEdge,
          via.center,
          via.center,
          (via.diameter + constraints.traceWidth) / 2 + constraints.clearance,
        )
        if (interval) blocked.push(interval)
      }
    }
    const coordinate = horizontal ? port.x : port.y
    if (
      blocked.some(
        (interval) =>
          coordinate >= interval.min - EPSILON &&
          coordinate <= interval.max + EPSILON,
      )
    )
      hasBlockedCrossing = true
    // Reserve the original topology's ordering, not the uniform proposal's
    // slots: the proposal may have moved multiple crossings onto one blocker.
    const peers = placed.filter(
      (peer) =>
        peer.z === port.z &&
        (peer.rootConnectionName ?? peer.connectionName) !==
          rootConnectionName &&
        !constraints.connMap.areIdsConnected(
          peer.rootConnectionName ?? peer.connectionName,
          rootConnectionName,
        ),
    )
    const preferred = horizontal ? original.x : original.y
    const spacing = constraints.traceWidth + constraints.clearance
    const lower = peers.map((peer) => (horizontal ? peer.x : peer.y) + spacing)
    let free: Interval[] = [
      {
        min: lower.length ? Math.max(edgeMin, ...lower) : edgeMin,
        max: edgeMax,
      },
    ].filter((span) => span.max > span.min)
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
    // Uniform spacing is an optimization, not a proof that the existing
    // topology can cross preserved copper. A boundary without an admissible
    // spacing proposal retains its graph crossing for the detailed router,
    // which can promote movable preload sections into regional repair.
    // It still validates copper conflicts; this stage must not reject those
    // routable topologies before regional repair has a chance to run.
    if (free.length === 0) {
      admissible = false
      placed.push(original)
      return original
    }
    if (free.some((span) => coordinate >= span.min && coordinate <= span.max)) {
      placed.push(port)
      return port
    }
    free.sort(
      (a, b) =>
        Math.abs((a.min + a.max) / 2 - preferred) -
        Math.abs((b.min + b.max) / 2 - preferred),
    )
    const position = (free[0]!.min + free[0]!.max) / 2
    const result = horizontal
      ? { ...port, x: position }
      : { ...port, y: position }
    placed.push(result)
    return result
  })
  // Accept the whole boundary proposal together so an unchanged graph crossing
  // cannot collide with a neighbor that was moved earlier in this pass.
  if (!hasBlockedCrossing) return portPoints
  return admissible ? proposal : originalPortPoints
}
