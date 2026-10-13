import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { hasPreloadedTraceSectionMetadata } from "./serializePreloadedTraceAssignments"

type Interval = { start: number; end: number }
type Point = { x: number; y: number }
export type RetainedCopper = {
  netId: string
  start: Point
  end: Point
  layers: number[]
  radius: number
  holeRadius: number
}
type ReservationMetadata = {
  suppliedNetIds: string[]
  retainedNetIds: string[]
}

export type RetainedCopperPortSource = {
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  traceWidth: number
  copperClearance: number
}

export type RetainedCopperTraceSection = {
  connectionName: string
  traceId: string
  startRoutePosition: number
  endRoutePosition: number
  netId: string
}

const getRetainedIntervals = (
  start: number,
  end: number,
  represented: readonly Interval[],
): Interval[] => {
  let retained = [{ start, end }]
  for (const owner of represented) {
    retained = retained.flatMap((part): Interval[] => {
      if (owner.end <= part.start || owner.start >= part.end) return [part]
      const remaining: Interval[] = []
      if (owner.start > part.start) {
        remaining.push({ start: part.start, end: owner.start })
      }
      if (owner.end < part.end) {
        remaining.push({ start: owner.end, end: part.end })
      }
      return remaining
    })
  }
  return retained
}

export const getRetainedCopperForTraceSections = (
  sections: readonly RetainedCopperTraceSection[],
  { srj, connMap }: RetainedCopperPortSource,
): RetainedCopper[] => {
  const traces = new Map<string, SimplifiedPcbTrace>()
  const nets = new Map<string, string>()
  const represented = new Map<string, Interval[]>()
  for (const trace of srj.traces ?? []) {
    const netId = connMap.getNetConnectedToId(trace.connection_name)
    if (!netId || traces.has(trace.pcb_trace_id)) {
      throw new Error(
        `Retained copper trace "${trace.pcb_trace_id}" has no unique owner`,
      )
    }
    traces.set(trace.pcb_trace_id, trace)
    nets.set(trace.pcb_trace_id, netId)
  }
  for (const section of sections) {
    const trace = traces.get(section.traceId)
    if (!trace) {
      throw new Error(`Retained copper owner has no trace "${section.traceId}"`)
    }
    const maximumPosition = trace.route.reduce(
      (maximum, point, index): number =>
        Math.max(
          maximum,
          index +
            (point.route_type === "through_obstacle" ||
            point.route_type === "jumper"
              ? 1
              : 0),
        ),
      0,
    )
    if (
      section.netId !== nets.get(section.traceId) ||
      !Number.isFinite(section.startRoutePosition) ||
      !Number.isFinite(section.endRoutePosition) ||
      section.startRoutePosition < 0 ||
      section.endRoutePosition > maximumPosition ||
      section.startRoutePosition > section.endRoutePosition
    ) {
      throw new Error(
        `Retained copper owner "${section.connectionName}" is invalid`,
      )
    }
    const intervals = represented.get(section.traceId) ?? []
    intervals.push({
      start: section.startRoutePosition,
      end: section.endRoutePosition,
    })
    represented.set(section.traceId, intervals)
  }

  const viaDimensions = getViaDimensions(srj)
  const copper: RetainedCopper[] = []
  const layerZ = (layer: string): number => {
    const z = mapLayerNameToZ(layer, srj.layerCount)
    if (!Number.isInteger(z) || z < 0 || z >= srj.layerCount) {
      throw new Error(`Retained copper has invalid layer "${layer}"`)
    }
    return z
  }
  for (const trace of traces.values()) {
    const netId = nets.get(trace.pcb_trace_id)!
    const owned = represented.get(trace.pcb_trace_id) ?? []
    for (const [index, point] of trace.route.entries()) {
      if (point.route_type === "via") {
        // A barrel strictly inside a represented span moves with its owner.
        // A boundary barrel still joins retained copper outside that span.
        if (
          owned.some(
            (owner): boolean => owner.start < index && index < owner.end,
          )
        ) {
          continue
        }
        const fromZ = layerZ(point.from_layer)
        const toZ = layerZ(point.to_layer)
        const minZ = srj.allowBlindAndBuriedVias ? Math.min(fromZ, toZ) : 0
        const maxZ = srj.allowBlindAndBuriedVias
          ? Math.max(fromZ, toZ)
          : srj.layerCount - 1
        const physicalLayers = point.layers?.map(layerZ)
        if (srj.allowBlindAndBuriedVias && physicalLayers) {
          const layerSet = new Set(physicalLayers)
          const physicalMinZ = Math.min(...physicalLayers)
          const physicalMaxZ = Math.max(...physicalLayers)
          if (
            !layerSet.has(fromZ) ||
            !layerSet.has(toZ) ||
            layerSet.size !== physicalMaxZ - physicalMinZ + 1
          ) {
            throw new Error(
              `Retained copper via in "${trace.pcb_trace_id}" has an invalid physical span`,
            )
          }
        }
        const layers =
          srj.allowBlindAndBuriedVias && physicalLayers
            ? [...new Set(physicalLayers)]
            : Array.from(
                { length: maxZ - minZ + 1 },
                (_, offset): number => minZ + offset,
              )
        const diameter = point.via_diameter ?? viaDimensions.padDiameter
        const holeDiameter =
          point.via_hole_diameter ?? viaDimensions.holeDiameter
        if (
          layers.length === 0 ||
          !Number.isFinite(diameter) ||
          !Number.isFinite(holeDiameter) ||
          diameter <= 0 ||
          holeDiameter < 0 ||
          holeDiameter >= diameter
        ) {
          throw new Error(
            `Retained copper via in "${trace.pcb_trace_id}" is invalid`,
          )
        }
        copper.push({
          netId,
          start: point,
          end: point,
          layers,
          radius: diameter / 2,
          holeRadius: holeDiameter / 2,
        })
        continue
      }
      const next = trace.route[index + 1]
      let start: Point
      let end: Point
      let layers: number[]
      if (point.route_type === "through_obstacle") {
        start = point.start
        end = point.end
        const fromZ = layerZ(point.from_layer)
        const toZ = layerZ(point.to_layer)
        layers = Array.from(
          { length: Math.abs(toZ - fromZ) + 1 },
          (_, offset): number => Math.min(fromZ, toZ) + offset,
        )
      } else if (
        point.route_type === "wire" &&
        next?.route_type === "wire" &&
        point.layer === next.layer
      ) {
        start = point
        end = next
        layers = [layerZ(point.layer)]
      } else {
        // Jumper pads are already represented by the original pad obstacles.
        continue
      }
      // SRJ wire width belongs to the wire beginning at this route position.
      const radius = point.width / 2
      if (!Number.isFinite(radius) || radius <= 0) {
        throw new Error(
          `Retained copper wire in "${trace.pcb_trace_id}" is invalid`,
        )
      }
      const intervals =
        point.route_type === "through_obstacle"
          ? [{ start: index, end: index + 1 }]
          : getRetainedIntervals(index, index + 1, owned)
      for (const interval of intervals) {
        const at = (position: number): Point => ({
          x: start.x + (end.x - start.x) * (position - index),
          y: start.y + (end.y - start.y) * (position - index),
        })
        copper.push({
          netId,
          start: at(interval.start),
          end: at(interval.end),
          layers,
          radius,
          holeRadius: 0,
        })
      }
    }
  }
  if (
    copper.some(
      (part): boolean =>
        ![part.start.x, part.start.y, part.end.x, part.end.y].every(
          Number.isFinite,
        ),
    )
  ) {
    throw new Error("Retained copper has nonfinite coordinates")
  }
  return copper
}

/** Keep foreign port footprints clear of unrepresented retained Cu. */
export const reserveRetainedCopperPorts = (
  graph: SerializedHyperGraph,
  source: RetainedCopperPortSource,
): number => {
  if ((source.srj.traces?.length ?? 0) === 0) return 0
  if (!Number.isFinite(source.traceWidth) || source.traceWidth <= 0) {
    throw new Error(
      "Retained copper port admission requires a positive wire width",
    )
  }
  if (!Number.isFinite(source.copperClearance) || source.copperClearance < 0) {
    throw new Error("Retained copper clearance must be finite and nonnegative")
  }
  const sections = (graph.connections ?? []).flatMap(
    (connection): RetainedCopperTraceSection[] => {
      if (!hasPreloadedTraceSectionMetadata(connection)) return []
      const netId = connection.mutuallyConnectedNetworkId
      if (typeof netId !== "string") {
        throw new Error("Retained copper section lacks its canonical owner")
      }
      return [{
        connectionName: connection.connectionId,
        ...connection.preloadedTraceSection,
        netId,
      }]
    },
  )
  const copper = getRetainedCopperForTraceSections(sections, source)
  const portRadius = source.traceWidth / 2
  let reserved = 0
  for (const port of graph.ports) {
    const point = port.d as { x: number; y: number; z: number }
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isInteger(point.z) ||
      point.z < 0 ||
      point.z >= source.srj.layerCount
    ) {
      throw new Error(
        `Retained copper port "${port.portId}" has invalid coordinates`,
      )
    }
    const previous = port.d?.retainedCopperPortAdmission as
      | ReservationMetadata
      | undefined
    const supplied = port.d?.immutableCopperNetIds as string[] | undefined
    if (
      supplied !== undefined &&
      (!Array.isArray(supplied) ||
        !supplied.every((netId): boolean => typeof netId === "string"))
    ) {
      throw new Error(`Port "${port.portId}" has invalid copper reservations`)
    }
    const suppliedNetIds = new Set(previous?.suppliedNetIds ?? supplied)
    for (const netId of supplied ?? []) {
      if (!previous?.retainedNetIds.includes(netId)) suppliedNetIds.add(netId)
    }
    const retainedNetIds = new Set<string>()
    for (const part of copper) {
      if (!part.layers.includes(point.z)) continue
      const radius = portRadius + part.radius + source.copperClearance
      if (
        point.x < Math.min(part.start.x, part.end.x) - radius ||
        point.x > Math.max(part.start.x, part.end.x) + radius ||
        point.y < Math.min(part.start.y, part.end.y) - radius ||
        point.y > Math.max(part.start.y, part.end.y) + radius
      ) {
        continue
      }
      const distance = minimumDistanceBetweenSegments(
        point,
        point,
        part.start,
        part.end,
      )
      if (
        distance < radius &&
        distance + portRadius + source.copperClearance > part.holeRadius
      ) {
        retainedNetIds.add(part.netId)
      }
    }
    if (retainedNetIds.size === 0 && previous === undefined) continue
    const metadata = { ...port.d }
    const immutableNetIds = [
      ...new Set([...suppliedNetIds, ...retainedNetIds]),
    ].sort()
    if (immutableNetIds.length > 0) {
      metadata.immutableCopperNetIds = immutableNetIds
    } else {
      delete metadata.immutableCopperNetIds
    }
    metadata.retainedCopperPortAdmission = {
      suppliedNetIds: [...suppliedNetIds].sort(),
      retainedNetIds: [...retainedNetIds].sort(),
    } satisfies ReservationMetadata
    port.d = metadata
    if (retainedNetIds.size > 0) reserved++
  }
  return reserved
}
