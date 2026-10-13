import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { ChangedPreloadedTraceSection } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import {
  getRetainedCopperForTraceSections,
  type RetainedCopper,
  type RetainedCopperTraceSection,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/reserveRetainedCopperPorts"
import type { SimpleRouteJson } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

type RetainedCopperPlacementSource = {
  srj: SimpleRouteJson
  sections: readonly ChangedPreloadedTraceSection[]
  connMap: ConnectivityMap
  traceWidth: number
  clearance: number
}
type RetainedCopperPlacementValidator = (
  proposed: readonly PortPoint[],
  original: readonly PortPoint[],
) => boolean

/** Preserve each retained primitive's clearance when placing a shared family. */
export const createRetainedCopperPortPlacementValidator = (
  source: RetainedCopperPlacementSource,
): RetainedCopperPlacementValidator => {
  if (
    !Number.isFinite(source.traceWidth) ||
    source.traceWidth <= 0 ||
    !Number.isFinite(source.clearance) ||
    source.clearance < 0
  ) {
    throw new Error(
      "Retained copper placement needs positive width and nonnegative clearance",
    )
  }
  const traces = new Map(
    (source.srj.traces ?? []).map((trace) => [trace.pcb_trace_id, trace]),
  )
  const netByRawName = new Map<string, string>()
  for (const name of new Set([
    ...source.srj.connections.map((connection) => connection.name),
    ...(source.srj.traces ?? []).map((trace) => trace.connection_name),
  ])) {
    const netId = source.connMap.getNetConnectedToId(name)
    if (!netId) throw new Error(`Placement owner "${name}" has no canonical net`)
    netByRawName.set(name, netId)
  }
  const netBySection = new Map<string, string>()
  const widthBySection = new Map<string, number>()
  const rippedSections: RetainedCopperTraceSection[] = source.sections.map(
    (section): RetainedCopperTraceSection => {
      const trace = traces.get(section.traceId)
      if (!trace) throw new Error(`Placement section lacks "${section.traceId}"`)
      const netId = netByRawName.get(trace.connection_name)!
      const previous = netBySection.get(section.connectionName)
      if (previous !== undefined && previous !== netId) {
        throw new Error("Placement section has conflicting copper owners")
      }
      // Reconstruction publishes the original trace's maximum stroke width.
      // Retained primitives below still use each wire's actual starting width.
      const widths = trace.route.flatMap((point): number[] =>
        point.route_type === "wire" || point.route_type === "through_obstacle"
          ? [point.width]
          : [],
      )
      const width = widths.length > 0
        ? Math.max(...widths)
        : source.traceWidth
      if (widths.some((value): boolean => !Number.isFinite(value) || value <= 0)) {
        throw new Error("Placement section has invalid published stroke width")
      }
      if (!Number.isFinite(width) || width <= 0) {
        throw new Error("Placement section has invalid requested wire width")
      }
      netBySection.set(section.connectionName, netId)
      widthBySection.set(section.connectionName, width)
      return {
        connectionName: section.connectionName,
        traceId: section.traceId,
        startRoutePosition: section.startRoutePosition,
        endRoutePosition: section.endRoutePosition,
        netId,
      }
    },
  )
  // Only actually ripped global sections have stopped being current fixed Cu.
  const copperByLayer = new Map<number, RetainedCopper[]>()
  for (const part of getRetainedCopperForTraceSections(rippedSections, {
    srj: source.srj,
    connMap: source.connMap,
    traceWidth: source.traceWidth,
    copperClearance: source.clearance,
  })) {
    for (const z of part.layers) {
      const layer = copperByLayer.get(z) ?? []
      layer.push(part)
      copperByLayer.set(z, layer)
    }
  }
  const gap = (point: PortPoint, part: RetainedCopper, radius: number): number => {
    const distance = minimumDistanceBetweenSegments(
      point,
      point,
      part.start,
      part.end,
    )
    const outsideGap = distance - part.radius - radius
    return part.holeRadius > 0
      ? Math.max(outsideGap, part.holeRadius - distance - radius)
      : outsideGap
  }
  return (
    proposed: readonly PortPoint[],
    original: readonly PortPoint[],
  ): boolean => {
    const originalById = new Map<string, PortPoint>()
    for (const point of original) {
      if (!point.portPointId || originalById.has(point.portPointId)) {
        throw new Error("Placement needs unique original port identities")
      }
      originalById.set(point.portPointId, point)
    }
    if (proposed.length !== original.length) {
      throw new Error("Placement changed the shared port family")
    }
    const proposedIds = new Set<string>()
    for (const point of proposed) {
      const portId = point.portPointId
      if (!portId) throw new Error("Placement lacks an authoritative port identity")
      const before = originalById.get(portId)
      if (
        !before ||
        proposedIds.has(portId) ||
        before.connectionName !== point.connectionName ||
        before.rootConnectionName !== point.rootConnectionName ||
        before.z !== point.z ||
        ![before.x, before.y, point.x, point.y].every(Number.isFinite) ||
        !Number.isInteger(point.z) ||
        point.z < 0 ||
        point.z >= source.srj.layerCount
      ) {
        throw new Error("Placement changed an authoritative port identity")
      }
      proposedIds.add(portId)
      const netId =
        netBySection.get(point.connectionName) ??
        netByRawName.get(point.connectionName)
      if (netId === undefined) {
        throw new Error(`Unknown placement owner "${point.connectionName}"`)
      }
      if (before.x === point.x && before.y === point.y) continue
      const radius =
        (widthBySection.get(point.connectionName) ?? source.traceWidth) / 2
      for (const part of copperByLayer.get(point.z) ?? []) {
        if (part.netId === netId) continue
        const afterGap = gap(point, part, radius)
        if (
          afterGap < source.clearance &&
          afterGap < gap(before, part, radius)
        ) {
          return false
        }
      }
    }
    return true
  }
}
