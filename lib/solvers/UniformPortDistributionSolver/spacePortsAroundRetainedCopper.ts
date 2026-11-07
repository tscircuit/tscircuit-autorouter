import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { PortPointWithOwnerPair, SharedEdge } from "./types"

type Point = { x: number; y: number }

/** Locate the intersection of a wire's clearance capsule with a mesh edge. */
const getBlockedInterval = (
  edge: SharedEdge,
  a: Point,
  b: Point,
  radius: number,
): { min: number; max: number; center: number } | undefined => {
  const vertical = edge.orientation === "vertical"
  const fixed = vertical ? edge.x1 : edge.y1
  const aFixed = vertical ? a.x : a.y
  const bFixed = vertical ? b.x : b.y
  const aAlong = vertical ? a.y : a.x
  const bAlong = vertical ? b.y : b.x
  const t =
    aFixed === bFixed
      ? 0.5
      : Math.max(0, Math.min(1, (fixed - aFixed) / (bFixed - aFixed)))
  const center = aAlong + (bAlong - aAlong) * t
  const distance = (along: number): number => {
    const point = vertical ? { x: fixed, y: along } : { x: along, y: fixed }
    return segmentToSegmentMinDistance(a, b, point, point)
  }
  if (distance(center) >= radius) return undefined
  let min = Math.min(aAlong, bAlong) - radius
  let max = Math.max(aAlong, bAlong) + radius
  let inside = center
  for (let i = 0; i < 40; i++) {
    const mid = (min + inside) / 2
    if (distance(mid) < radius) inside = mid
    else min = mid
  }
  inside = center
  for (let i = 0; i < 40; i++) {
    const mid = (max + inside) / 2
    if (distance(mid) < radius) inside = mid
    else max = mid
  }
  return { min, max, center }
}

/** Reserve physical clearance at retained crossings without changing their order. */
export const spacePortsAroundRetainedCopper = ({
  edge,
  originalPorts,
  preferredPorts,
  movableIds,
  routes,
  traceWidth,
  clearance,
  connMap,
}: {
  edge: SharedEdge
  originalPorts: PortPointWithOwnerPair[]
  preferredPorts: PortPointWithOwnerPair[]
  movableIds: ReadonlySet<string>
  routes: HighDensityRoute[]
  traceWidth: number
  clearance: number
  connMap: ConnectivityMap
}): PortPointWithOwnerPair[] => {
  const vertical = edge.orientation === "vertical"
  const coordinate = (point: Point): number => (vertical ? point.y : point.x)
  const min = Math.min(
    coordinate({ x: edge.x1, y: edge.y1 }),
    coordinate({ x: edge.x2, y: edge.y2 }),
  )
  const max = Math.max(
    coordinate({ x: edge.x1, y: edge.y1 }),
    coordinate({ x: edge.x2, y: edge.y2 }),
  )
  const preferredById = new Map(
    preferredPorts.map((port) => [port.portPointId, port]),
  )
  const results = new Map<string, PortPointWithOwnerPair>()
  for (const z of new Set(originalPorts.map((port) => port.z))) {
    let affected = false
    const ports = originalPorts
      .filter((port) => port.z === z)
      .sort((a, b) => coordinate(a) - coordinate(b))
    const entries = ports.map((port) => {
      const original = coordinate(port)
      const movable = Boolean(
        port.portPointId && movableIds.has(port.portPointId),
      )
      let low = movable ? min : original
      let high = movable ? max : original
      if (movable) {
        for (const route of routes) {
          const portNet =
            connMap.getNetConnectedToId(port.connectionName) ??
            (port.rootConnectionName &&
              (connMap.getNetConnectedToId(port.rootConnectionName) ??
                (connMap.netMap[port.rootConnectionName]
                  ? port.rootConnectionName
                  : undefined)))
          const routeNet =
            connMap.getNetConnectedToId(route.connectionName) ??
            (route.rootConnectionName &&
              (connMap.getNetConnectedToId(route.rootConnectionName) ??
                (connMap.netMap[route.rootConnectionName]
                  ? route.rootConnectionName
                  : undefined)))
          if (portNet && portNet === routeNet) continue
          for (let i = 0; i < route.route.length - 1; i++) {
            const a = route.route[i]!,
              b = route.route[i + 1]!
            if (a.z !== z || b.z !== z) continue
            // Only edge crossings are anchors shared by neighboring regions.
            // Nearby copper within a region remains movable during HD repair.
            if (
              segmentToSegmentMinDistance(
                a,
                b,
                { x: edge.x1, y: edge.y1 },
                { x: edge.x2, y: edge.y2 },
              ) > 1e-8
            )
              continue
            const radius =
              (traceWidth + (a.traceThickness ?? route.traceThickness)) / 2 +
              clearance +
              1e-6
            const interval = getBlockedInterval(edge, a, b, radius)
            if (!interval || interval.max < min || interval.min > max) continue
            affected = true
            if (original < interval.center) high = Math.min(high, interval.min)
            else low = Math.max(low, interval.max)
          }
        }
      }
      return {
        port,
        low,
        high,
        preferred: coordinate(preferredById.get(port.portPointId) ?? port),
      }
    })
    if (!affected) continue
    // Keep neighboring new ports in their established order as well. Their
    // ordinary uniform spacing is retained wherever the reserved copper allows.
    for (let i = 1; i < entries.length; i++)
      entries[i]!.low = Math.max(entries[i]!.low, entries[i - 1]!.low + 1e-8)
    for (let i = entries.length - 2; i >= 0; i--)
      entries[i]!.high = Math.min(entries[i]!.high, entries[i + 1]!.high - 1e-8)
    let previous = -Infinity
    for (const entry of entries) {
      if (entry.low > entry.high + 1e-8) {
        throw new Error(
          `No clearance interval for port "${entry.port.portPointId}" on mesh edge "${edge.ownerPairKey}": ${JSON.stringify({ low: entry.low, high: entry.high, port: entry.port, edge })}`,
        )
      }
      const value = Math.max(
        entry.low,
        previous + 1e-8,
        Math.min(entry.high, entry.preferred),
      )
      previous = value
      results.set(entry.port.portPointId!, {
        ...entry.port,
        ...(vertical ? { y: value } : { x: value }),
      })
    }
  }
  return originalPorts.map(
    (port) =>
      results.get(port.portPointId!) ??
      preferredById.get(port.portPointId) ??
      port,
  )
}
