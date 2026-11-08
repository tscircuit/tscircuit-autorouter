import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { getWireClearanceInterval } from "./getWireClearanceInterval"
import { getObstacleClearanceInterval } from "./getObstacleClearanceInterval"
import type { PortPointWithOwnerPair, SharedEdge } from "./types"

type Point = { x: number; y: number }

/** Reserve physical clearance at retained crossings without changing their order. */
export const spacePortsAroundRetainedCopper = ({
  edge,
  originalPorts,
  preferredPorts,
  neighboringPorts = [],
  movableIds,
  routes,
  traceWidth,
  clearance,
  connMap,
  boundsByPortId,
  obstacles = [],
  layerCount,
}: {
  edge: SharedEdge
  originalPorts: PortPointWithOwnerPair[]
  preferredPorts: PortPointWithOwnerPair[]
  neighboringPorts?: PortPointWithOwnerPair[]
  movableIds: ReadonlySet<string>
  routes: Array<HighDensityRoute & { isFixed?: boolean }>
  traceWidth: number
  clearance: number
  connMap: ConnectivityMap
  boundsByPortId?: Map<string, { min: number; max: number }>
  obstacles?: Obstacle[]
  layerCount?: number
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
        for (const obstacle of obstacles) {
          const zs =
            obstacle.__zLayers ??
            obstacle.zLayers ??
            (layerCount === undefined
              ? undefined
              : obstacle.layers.map((layer) =>
                  mapLayerNameToZ(layer, layerCount),
                ))
          if (zs && !zs.includes(z)) continue
          const interval = getObstacleClearanceInterval(
            edge,
            obstacle,
            traceWidth / 2 + clearance,
          )
          if (!interval) continue
          if (
            obstacle.connectedTo.some(
              (id) =>
                id === port.connectionName ||
                id === port.rootConnectionName ||
                connMap.areIdsConnected(id, port.connectionName) ||
                (port.rootConnectionName &&
                  connMap.areIdsConnected(id, port.rootConnectionName)),
            )
          )
            continue
          affected = true
          const belowFits = interval.min >= min - 1e-8
          const aboveFits = interval.max <= max + 1e-8
          if (
            belowFits &&
            (!aboveFits || original - interval.min <= interval.max - original)
          )
            high = Math.min(high, interval.min)
          else low = Math.max(low, interval.max)
        }
        // Ports on perpendicular edges are locked HD anchors too. Reserve
        // their circular copper clearance before regional routing begins.
        for (const neighbor of neighboringPorts) {
          if (
            neighbor.z !== z ||
            neighbor.connectionName === port.connectionName ||
            connMap.areIdsConnected(
              neighbor.connectionName,
              port.connectionName,
            )
          )
            continue
          const interval = getWireClearanceInterval(
            edge,
            neighbor,
            neighbor,
            traceWidth + clearance + 1e-6,
          )
          if (!interval || interval.max < min || interval.min > max) continue
          affected = true
          if (original < interval.center) high = Math.min(high, interval.min)
          else low = Math.max(low, interval.max)
        }
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
            // A retained crossing constrains both neighboring regions. Explicitly
            // fixed copper also constrains nearby edges that it does not cross;
            // regional repair cannot move that copper away from a locked port.
            if (
              route.isFixed !== true &&
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
            const interval = getWireClearanceInterval(edge, a, b, radius)
            if (!interval || interval.max < min || interval.min > max) continue
            affected = true
            if (original < interval.center) high = Math.min(high, interval.min)
            else low = Math.max(low, interval.max)
          }
        }
      }
      boundsByPortId?.set(port.portPointId!, { min: low, max: high })
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
    const separation = (
      left: (typeof entries)[number],
      right: (typeof entries)[number],
    ): number =>
      left.port.connectionName === right.port.connectionName ||
      connMap.areIdsConnected(
        left.port.connectionName,
        right.port.connectionName,
      )
        ? 1e-8
        : traceWidth + clearance + 1e-6
    for (let i = 1; i < entries.length; i++)
      entries[i]!.low = Math.max(
        entries[i]!.low,
        entries[i - 1]!.low + separation(entries[i - 1]!, entries[i]!),
      )
    for (let i = entries.length - 2; i >= 0; i--)
      entries[i]!.high = Math.min(
        entries[i]!.high,
        entries[i + 1]!.high - separation(entries[i]!, entries[i + 1]!),
      )
    let previous = -Infinity
    for (const [index, entry] of entries.entries()) {
      const gap = index === 0 ? 0 : separation(entries[index - 1]!, entry)
      if (entry.low > entry.high + 1e-8) {
        throw new Error(
          `No clearance interval for port "${entry.port.portPointId}" on mesh edge "${edge.ownerPairKey}": ${JSON.stringify({ low: entry.low, high: entry.high, port: entry.port, edge })}`,
        )
      }
      const value = Math.max(
        entry.low,
        previous + gap,
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
