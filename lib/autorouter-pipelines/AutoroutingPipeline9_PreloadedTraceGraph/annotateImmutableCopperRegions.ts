import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import Flatbush from "flatbush"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"
import { getPipeline9PhysicalOwnership, getPipeline9PhysicalRouteOwner } from "./getPipeline9PhysicalOwnership"

export type SerializedFixedCopperSegment = {
  netId: string | null
  x1: number
  y1: number
  x2: number
  y2: number
  z: number
  width: number
  clearance: number
}

type RegionBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type FixedCopperRegionData = {
  center: { x: number; y: number }
  width: number
  height: number
  availableZ: number[]
  bounds?: RegionBounds
  fixedCopperSegments?: SerializedFixedCopperSegment[]
  fixedCopperTraceWidth?: number
}

/** Association only: a region boundary is not a physical copper or via limit. */
const segmentIntersectsExpandedBounds = (
  segment: SerializedFixedCopperSegment,
  bounds: RegionBounds,
  radius: number,
): boolean => {
  let t0 = 0
  let t1 = 1
  for (const [start, delta, minimum, maximum] of [
    [segment.x1, segment.x2 - segment.x1, bounds.minX - radius, bounds.maxX + radius],
    [segment.y1, segment.y2 - segment.y1, bounds.minY - radius, bounds.maxY + radius],
  ]) {
    if (delta === 0) {
      if (start < minimum || start > maximum) return false
      continue
    }
    const enter = (minimum - start) / delta
    const leave = (maximum - start) / delta
    t0 = Math.max(t0, Math.min(enter, leave))
    t1 = Math.min(t1, Math.max(enter, leave))
    if (t0 > t1) return false
  }
  return true
}

/** Expose certified immutable copper to soft regional planning, never as mutable routes. */
export const annotateImmutableCopperRegions = ({
  graph,
  srj,
  originalSrj,
  immutableTraceIds,
}: {
  graph: SerializedHyperGraph
  srj: SimpleRouteJson
  originalSrj: SimpleRouteJson
  immutableTraceIds: ReadonlySet<string>
}): { regions: number; segmentAssociations: number } => {
  if (immutableTraceIds.size === 0) return { regions: 0, segmentAssociations: 0 }
  const traces = srj.traces ?? []
  const selectedTraces = traces.flatMap((trace, index) =>
    immutableTraceIds.has(trace.pcb_trace_id) ? [{ trace, index }] : [],
  )
  const selectedIds = new Set(selectedTraces.map(({ trace }) => trace.pcb_trace_id))
  if (selectedIds.size !== immutableTraceIds.size || selectedIds.size !== selectedTraces.length) {
    throw new Error("Immutable regional copper requires one source trace for every certified trace ID")
  }
  const traceWidth = srj.minTraceWidth
  // Pipeline9 uses this declared gap for original-frame trace-to-trace physical
  // acceptance too; defaultObstacleMargin is its separate search heuristic.
  const clearance = originalSrj.minTraceToPadEdgeClearance ?? 0.1
  if (!Number.isFinite(traceWidth) || traceWidth <= 0 || !Number.isFinite(clearance) || clearance < 0) {
    throw new Error("Immutable regional copper requires finite positive widths and nonnegative clearance")
  }
  const candidateWidths = srj.connections.map((connection) =>
    connection.nominalTraceWidth ?? connection.width ?? traceWidth,
  )
  if (candidateWidths.some((width) => !Number.isFinite(width) || width <= 0)) {
    throw new Error("Immutable regional copper requires finite positive routed trace widths")
  }
  // Association must include copper close enough to affect a wider routed net.
  // Native transition costs use that route's declared width where available.
  const maximumCandidateWidth = Math.max(traceWidth, ...candidateWidths)
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const viaDiameter = getViaDimensions(srj).padDiameter
  const routes = selectedTraces.flatMap(({ trace, index }) =>
    convertPreloadedTraceToHdRoutes(trace, index, srj.layerCount, viaDiameter, connMap),
  )
  const ownership = getPipeline9PhysicalOwnership({
    originalSrj, derivedConnections: srj.connections, derivedTraces: traces, routingConnMap: connMap,
    derivedRouteAliases: routes.map((route) => ({ connectionName: route.connectionName,
      parentTraceId: traces[route.preloadedTraceIndex]!.pcb_trace_id })),
  })
  const liveNetIds = new Set((graph.connections ?? []).map((connection) => connection.mutuallyConnectedNetworkId))
  const routingNetIdsByOwner = new Map<string, string[]>()
  for (const [netId, owner] of Object.entries(ownership.routingNetOwners)) {
    if (owner === null || !liveNetIds.has(netId)) continue
    const ids = routingNetIdsByOwner.get(owner) ?? []
    ids.push(netId)
    routingNetIdsByOwner.set(owner, ids)
  }
  const regionEntries = graph.regions.map((region) => {
    const data = region.d as FixedCopperRegionData | undefined
    if (!data || !data.center || !Array.isArray(data.availableZ)) {
      throw new Error(`Immutable regional copper requires geometric region data for "${region.regionId}"`)
    }
    const bounds = data.bounds ?? {
      minX: data.center.x - data.width / 2, maxX: data.center.x + data.width / 2,
      minY: data.center.y - data.height / 2, maxY: data.center.y + data.height / 2,
    }
    if (!Object.values(bounds).every(Number.isFinite) || bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
      throw new Error(`Immutable regional copper requires finite ordered bounds for "${region.regionId}"`)
    }
    delete data.fixedCopperSegments
    delete data.fixedCopperTraceWidth
    return { data, bounds }
  })
  if (regionEntries.length === 0) return { regions: 0, segmentAssociations: 0 }
  const regionIndex = new Flatbush(regionEntries.length)
  for (const { bounds } of regionEntries) regionIndex.add(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)
  regionIndex.finish()
  let segmentAssociations = 0
  for (const route of routes) {
    const owner = getPipeline9PhysicalRouteOwner(ownership, route)
    const routingIds = owner === undefined ? undefined : routingNetIdsByOwner.get(owner)
    const netId = routingIds?.length === 1 ? routingIds[0]! : null
    const first = route.route[0]!
    const last = route.route.at(-1)!
    const isVia = first.z !== last.z
    const width = isVia ? route.viaDiameter : route.traceThickness
    const firstZ = isVia && !srj.allowBlindAndBuriedVias ? 0 : Math.min(first.z, last.z)
    const lastZ = isVia && !srj.allowBlindAndBuriedVias ? srj.layerCount - 1 : Math.max(first.z, last.z)
    const radius = (width + maximumCandidateWidth) / 2 + clearance
    if (![first.x, first.y, last.x, last.y, width, radius].every(Number.isFinite) || width <= 0) {
      throw new Error(`Immutable regional copper has invalid geometry for "${route.connectionName}"`)
    }
    const nearby = regionIndex.search(Math.min(first.x, last.x) - radius, Math.min(first.y, last.y) - radius,
      Math.max(first.x, last.x) + radius, Math.max(first.y, last.y) + radius)
    for (let z = firstZ; z <= lastZ; z++) {
      const segment: SerializedFixedCopperSegment = {
        netId, x1: first.x, y1: first.y, x2: last.x, y2: last.y, z, width, clearance,
      }
      for (const index of nearby) {
        const { data, bounds } = regionEntries[index]!
        if (!data.availableZ.includes(z) || !segmentIntersectsExpandedBounds(segment, bounds, radius)) continue
        const segments = data.fixedCopperSegments ?? []
        segments.push(segment)
        data.fixedCopperSegments = segments
        data.fixedCopperTraceWidth = traceWidth
        segmentAssociations++
      }
    }
  }
  return { regions: regionEntries.filter(({ data }) => data.fixedCopperSegments?.length).length, segmentAssociations }
}
