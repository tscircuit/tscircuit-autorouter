import {
  doSegmentsIntersect,
  getSegmentIntersection,
} from "@tscircuit/math-utils"
import type { SimplifiedPcbTraces } from "lib/types"

export type ConnectivityLookup = {
  areIdsConnected: (idA: string, idB: string) => boolean
}

export type SameLayerCrossing = {
  layer: string
  x: number
  y: number
  traceAId: string
  traceBId: string
  connectionA: string
  connectionB: string
}

type Segment = {
  x1: number
  y1: number
  x2: number
  y2: number
  layer: string
  traceId: string
  connectionName: string
}

const ENDPOINT_EPS = 1e-6

function tracesAreSameConnection(
  a: Segment,
  b: Segment,
  connMap?: ConnectivityLookup | null,
): boolean {
  if (a.traceId === b.traceId) return true
  if (
    a.connectionName &&
    b.connectionName &&
    a.connectionName === b.connectionName
  ) {
    return true
  }
  if (!connMap) return false

  const idsA = [a.traceId, a.connectionName].filter(Boolean)
  const idsB = [b.traceId, b.connectionName].filter(Boolean)
  for (const idA of idsA) {
    for (const idB of idsB) {
      try {
        if (connMap.areIdsConnected(idA, idB)) return true
      } catch {
        // Connectivity maps can throw on unknown ids; treat as disconnected.
      }
    }
  }
  return false
}

function isNear(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  eps = ENDPOINT_EPS,
): boolean {
  return Math.abs(ax - bx) < eps && Math.abs(ay - by) < eps
}

function pointOnSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-18) return isNear(px, py, x1, y1)
  const t = ((px - x1) * dx + (py - y1) * dy) / len2
  if (t < -ENDPOINT_EPS || t > 1 + ENDPOINT_EPS) return false
  return isNear(px, py, x1 + t * dx, y1 + t * dy)
}

function segmentIntersection(
  a: Segment,
  b: Segment,
): { x: number; y: number } | null {
  if (a.layer !== b.layer) return null
  const a1 = { x: a.x1, y: a.y1 }
  const a2 = { x: a.x2, y: a.y2 }
  const b1 = { x: b.x1, y: b.y1 }
  const b2 = { x: b.x2, y: b.y2 }
  const point = getSegmentIntersection(a1, a2, b1, b2)
  if (point) return point
  if (!doSegmentsIntersect(a1, a2, b1, b2)) return null

  const candidates = [a1, a2, b1, b2]
  return (
    candidates.find(
      (p) =>
        pointOnSegment(p.x, p.y, a.x1, a.y1, a.x2, a.y2) &&
        pointOnSegment(p.x, p.y, b.x1, b.y1, b.x2, b.y2),
    ) ?? {
      x: (a.x1 + a.x2 + b.x1 + b.x2) / 4,
      y: (a.y1 + a.y2 + b.y1 + b.y2) / 4,
    }
  )
}

function isSharedEndpoint(
  a: Segment,
  b: Segment,
  point: { x: number; y: number },
): boolean {
  const onAEnd =
    isNear(point.x, point.y, a.x1, a.y1) || isNear(point.x, point.y, a.x2, a.y2)
  const onBEnd =
    isNear(point.x, point.y, b.x1, b.y1) || isNear(point.x, point.y, b.x2, b.y2)
  return onAEnd && onBEnd
}

/**
 * Detects same-layer crossings between traces that belong to different
 * connections. Shared endpoints (via/pad junctions) are ignored; interior
 * X crossings, T-junctions, and collinear overlaps on different nets are
 * reported.
 */
export function findSameLayerDifferentConnectionCrossings(
  traces: SimplifiedPcbTraces,
  connMap?: ConnectivityLookup | null,
): SameLayerCrossing[] {
  const segments: Segment[] = []

  for (const trace of traces) {
    const pts = trace.route
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      if (a.route_type !== "wire" || b.route_type !== "wire") continue
      if (a.layer !== b.layer) continue
      segments.push({
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        layer: a.layer,
        traceId: trace.pcb_trace_id,
        connectionName: trace.connection_name,
      })
    }
  }

  const crossings: SameLayerCrossing[] = []
  const seen = new Set<string>()

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i]!
      const b = segments[j]!
      if (tracesAreSameConnection(a, b, connMap)) continue

      const point = segmentIntersection(a, b)
      if (!point) continue
      if (isSharedEndpoint(a, b, point)) continue

      const key = [
        a.layer,
        Math.round(point.x * 1e6),
        Math.round(point.y * 1e6),
        [a.traceId, b.traceId].sort().join("|"),
      ].join(":")
      if (seen.has(key)) continue
      seen.add(key)

      crossings.push({
        layer: a.layer,
        x: point.x,
        y: point.y,
        traceAId: a.traceId,
        traceBId: b.traceId,
        connectionA: a.connectionName,
        connectionB: b.connectionName,
      })
    }
  }

  return crossings
}

export function getSameLayerCrossingFailure(
  traces: SimplifiedPcbTraces,
  connMap?: ConnectivityLookup | null,
): string | null {
  const crossings = findSameLayerDifferentConnectionCrossings(traces, connMap)
  if (crossings.length === 0) return null
  const first = crossings[0]!
  const extra = crossings.length > 1 ? ` (${crossings.length} crossings)` : ""
  return (
    `Same-layer crossing between different connections at (${first.x.toFixed(3)}, ${first.y.toFixed(3)}) ` +
    `layer=${first.layer}: ${first.traceAId} x ${first.traceBId}${extra}`
  )
}
