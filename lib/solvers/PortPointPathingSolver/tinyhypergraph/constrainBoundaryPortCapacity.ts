import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getWireClearanceInterval } from "../../UniformPortDistributionSolver/getWireClearanceInterval"
import type { Obstacle } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { getObstacleClearanceInterval } from "../../UniformPortDistributionSolver/getObstacleClearanceInterval"
import type { SharedEdge } from "../../UniformPortDistributionSolver/types"

export type PortGeometry = {
  traceWidth: number
  netMap: Record<string, string[]>
  clearance: number
  obstacles: Obstacle[]
  layerCount: number
  retainedRoutes: Array<HighDensityRoute & { isFixed?: boolean }>
}

/** Demand may add graph slots only where another physical trace can fit. */
export const constrainBoundaryPortCapacity = (
  graph: SerializedHyperGraph,
  geometry: PortGeometry,
  boundsByPortId?: Map<
    string,
    { minX: number; maxX: number; minY: number; maxY: number }
  >,
): SerializedHyperGraph => {
  const regions = new Map(
    graph.regions.map((region) => [region.regionId, region]),
  )
  const groups = new Map<string, typeof graph.ports>()
  for (const port of graph.ports) {
    const key = JSON.stringify([
      [port.region1Id, port.region2Id].sort(),
      port.d?.z,
    ])
    const ports = groups.get(key) ?? []
    ports.push(port)
    groups.set(key, ports)
  }
  const allowedNetsByPort = new Map<string, string[]>()
  const netByAlias = new Map<string, string>()
  // Internal net keys may also be obsolete aliases of another net. Resolve
  // obstacle aliases through the same connectivity map used by graph planning.
  for (const [net, aliases] of Object.entries(geometry.netMap)) {
    for (const alias of aliases) netByAlias.set(alias, net)
  }
  const removed = new Set<string>()
  for (const ports of groups.values()) {
    const duplicates = ports.filter(
      (port) => typeof port.d?.duplicatedFromPortId === "string",
    )
    if (!duplicates.length && !ports.some((port) => port.d?.cramped)) continue
    const first = ports[0]!
    const a = regions.get(first.region1Id)!.d!
    const b = regions.get(first.region2Id)!.d!
    const x1 = Math.max(a.center.x - a.width / 2, b.center.x - b.width / 2)
    const x2 = Math.min(a.center.x + a.width / 2, b.center.x + b.width / 2)
    const y1 = Math.max(a.center.y - a.height / 2, b.center.y - b.height / 2)
    const y2 = Math.min(a.center.y + a.height / 2, b.center.y + b.height / 2)
    const vertical = x2 - x1 < y2 - y1
    const edge: SharedEdge = {
      ownerNodeIds: [first.region1Id, first.region2Id],
      ownerPairKey: `${first.region1Id}|${first.region2Id}`,
      orientation: vertical ? "vertical" : "horizontal",
      x1: vertical ? (x1 + x2) / 2 : x1,
      x2: vertical ? (x1 + x2) / 2 : x2,
      y1: vertical ? y1 : (y1 + y2) / 2,
      y2: vertical ? y2 : (y1 + y2) / 2,
      center: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
      length: Math.max(x2 - x1, y2 - y1),
      nodeSideByOwnerId: {},
    }
    let intervals = [{ min: vertical ? y1 : x1, max: vertical ? y2 : x2 }]
    const padIntervals: Array<{ min: number; max: number; nets: string[] }> = []
    for (const obstacle of geometry.obstacles) {
      const layers =
        obstacle.__zLayers ??
        obstacle.zLayers ??
        obstacle.layers.map((layer) =>
          mapLayerNameToZ(layer, geometry.layerCount),
        )
      if (!layers.includes(first.d!.z)) continue
      const blocked = getObstacleClearanceInterval(
        edge,
        obstacle,
        geometry.traceWidth / 2 + geometry.clearance,
      )
      if (!blocked) continue
      padIntervals.push({
        ...blocked,
        nets: [
          ...new Set(
            obstacle.connectedTo.flatMap((id) => {
              const net = netByAlias.get(id)
              return net ? [net] : []
            }),
          ),
        ],
      })
      intervals = intervals.flatMap((interval) => {
        if (blocked.max <= interval.min || blocked.min >= interval.max)
          return [interval]
        return [
          { min: interval.min, max: Math.min(interval.max, blocked.min) },
          { min: Math.max(interval.min, blocked.max), max: interval.max },
        ].filter((part) => part.max >= part.min)
      })
    }
    // A passage closed to foreign signals may still be a legal pad escape.
    // Preserve it only for owners whose own pad copper leaves a free interval.
    if (!intervals.length && !a._containsTarget && !b._containsTarget) {
      const allowedNets = [
        ...new Set(padIntervals.flatMap((pad) => pad.nets)),
      ].filter((net) => {
        let ownedIntervals = [
          { min: vertical ? y1 : x1, max: vertical ? y2 : x2 },
        ]
        for (const blocked of padIntervals) {
          if (blocked.nets.includes(net)) continue
          ownedIntervals = ownedIntervals.flatMap((interval) => {
            if (blocked.max <= interval.min || blocked.min >= interval.max)
              return [interval]
            return [
              { min: interval.min, max: Math.min(interval.max, blocked.min) },
              { min: Math.max(interval.min, blocked.max), max: interval.max },
            ].filter((part) => part.max >= part.min)
          })
        }
        return ownedIntervals.length > 0
      })
      for (const port of ports) {
        if (
          !(
            port.d?.cramped || typeof port.d?.duplicatedFromPortId === "string"
          ) ||
          port.d?._preloadedTracePortAssignments?.length
        )
          continue
        if (allowedNets.length) allowedNetsByPort.set(port.portId, allowedNets)
        else removed.add(port.portId)
      }
      continue
    }
    const occupiedIntervals: Array<{
      min: number
      max: number
      center: number
    }> = []
    for (const route of geometry.retainedRoutes) {
      if (!route.isFixed) continue
      for (let i = 1; i < route.route.length; i++) {
        const a = route.route[i - 1]!
        const b = route.route[i]!
        if (a.z !== first.d!.z || b.z !== first.d!.z) continue
        const blocked = getWireClearanceInterval(
          edge,
          a,
          b,
          (geometry.traceWidth + (a.traceThickness ?? route.traceThickness)) /
            2 +
            geometry.clearance,
        )
        if (!blocked) continue
        occupiedIntervals.push(blocked)
        intervals = intervals.flatMap((interval) => {
          if (blocked.max <= interval.min || blocked.min >= interval.max)
            return [interval]
          return [
            { min: interval.min, max: Math.min(interval.max, blocked.min) },
            { min: Math.max(interval.min, blocked.max), max: interval.max },
          ].filter((part) => part.max >= part.min)
        })
      }
    }
    if (intervals.length && !a._containsTarget && !b._containsTarget) {
      for (const port of ports) {
        if (!port.d?.cramped || port.d?._preloadedTracePortAssignments?.length)
          continue
        const minimum = Math.min(...intervals.map((interval) => interval.min))
        const maximum = Math.max(...intervals.map((interval) => interval.max))
        boundsByPortId?.set(port.portId, {
          minX: vertical ? edge.x1 : minimum,
          maxX: vertical ? edge.x1 : maximum,
          minY: vertical ? minimum : edge.y1,
          maxY: vertical ? maximum : edge.y1,
        })
      }
    }
    const pitch = geometry.traceWidth + geometry.clearance
    let last = -Infinity
    let capacity = 0
    for (const interval of intervals) {
      const start = Math.max(interval.min, last + pitch)
      if (start > interval.max + 1e-8) continue
      const count = Math.floor((interval.max - start + 1e-8) / pitch) + 1
      capacity += count
      last = start + (count - 1) * pitch
    }
    // Existing slots include net-specific pad escapes and retained crossings.
    // This pass limits added demand slots; it does not remove those terminals.
    const occupiedOriginalPorts = ports.filter(
      (port) =>
        typeof port.d?.duplicatedFromPortId !== "string" &&
        port.d?._preloadedTracePortAssignments?.some(
          (assignment: { isFixed?: boolean }) => assignment.isFixed,
        ),
    ).length
    const additionalCapacity = Math.max(
      0,
      capacity + occupiedOriginalPorts - (ports.length - duplicates.length),
    )
    let added = 0
    for (const port of duplicates) {
      const original = vertical ? port.d!.y : port.d!.x
      let low = vertical ? y1 : x1
      let high = vertical ? y2 : x2
      for (const occupied of occupiedIntervals) {
        if (original < occupied.center) high = Math.min(high, occupied.min)
        else low = Math.max(low, occupied.max)
      }
      const hasInterval = intervals.some(
        (interval) =>
          Math.max(low, interval.min) <= Math.min(high, interval.max) + 1e-8,
      )
      if (added >= additionalCapacity || !hasInterval) removed.add(port.portId)
      else added++
    }
  }
  return {
    ...graph,
    ports: graph.ports
      .filter((port) => !removed.has(port.portId))
      .map((port) => {
        const allowed = allowedNetsByPort.get(port.portId)
        return allowed
          ? { ...port, d: { ...port.d, clearanceAllowedNetIds: allowed } }
          : port
      }),
    regions: graph.regions.map((region) => ({
      ...region,
      pointIds: region.pointIds.filter((id) => !removed.has(id)),
    })),
  }
}
