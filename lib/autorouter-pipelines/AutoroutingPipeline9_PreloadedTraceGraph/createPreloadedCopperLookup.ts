import { getBoundingBox, pointToSegmentDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import { getSegmentCapsuleInterval } from "lib/utils/getSegmentCapsuleInterval"
import { getSegmentObstacleClearanceInterval } from "lib/utils/getSegmentObstacleClearanceInterval"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import {
  convertPreloadedTraceToHdRoutes,
  type PreloadedHighDensityRoute,
} from "./convertPreloadedTraceToHdRoutes"
import { arePipeline9RoutesOnSameNet, getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"

type Point = { x: number; y: number }
type CopperPrimitive = {
  route: PreloadedHighDensityRoute
  kind: "wire" | "via"
  start: Point
  end: Point
  minZ: number
  maxZ: number
  radius: number
}
export type PreloadedCopperInput = {
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  traceWidth: number
  viaDiameter: number
}
type CopperSegment = { start: Point; end: Point; z: number; connectionName?: string; rootConnectionName?: string }
type CopperLookupContext = {
  index?: FlatbushIndex<CopperPrimitive>
  connMap: ConnectivityMap
  activeNets: Set<string>
  padIndex?: FlatbushIndex<Obstacle>
  layerCount: number
  traceWidth: number
  clearance: number
}
export type PreloadedCopperLookup = {
  getBlockers: (
    point: Pick<PortPoint, "x" | "y" | "z">,
    options?: { includeClearance?: boolean },
  ) => PreloadedHighDensityRoute[]
  getClearSpans: (segment: CopperSegment) => Array<[number, number]>
}

export function createPreloadedCopperIndex({
  srj,
  connMap,
  viaDiameter,
}: Pick<PreloadedCopperInput, "srj" | "connMap" | "viaDiameter">):
  | FlatbushIndex<CopperPrimitive>
  | undefined {
  const copper: CopperPrimitive[] = []
  for (const [traceIndex, trace] of (srj.traces ?? []).entries()) {
    const routes = convertPreloadedTraceToHdRoutes(
      trace,
      traceIndex,
      srj.layerCount,
      viaDiameter,
      connMap,
    )
    for (const route of routes) {
      const geometry = getPipeline9RouteCopperGeometry(route, srj)
      for (const wire of geometry.wireSegments) {
        copper.push({
          route,
          kind: "wire",
          start: wire.start,
          end: wire.end,
          minZ: wire.z,
          maxZ: wire.z,
          radius: wire.width / 2,
        })
      }
      for (const via of geometry.viaSpans) {
        copper.push({
          route,
          kind: "via",
          start: via.center,
          end: via.center,
          minZ: via.minZ,
          maxZ: via.maxZ,
          radius: via.diameter / 2,
        })
      }
    }
  }
  if (copper.length === 0) return undefined
  const index = new FlatbushIndex<CopperPrimitive>(copper.length)
  for (const primitive of copper) {
    index.insert(
      primitive,
      Math.min(primitive.start.x, primitive.end.x) - primitive.radius,
      Math.min(primitive.start.y, primitive.end.y) - primitive.radius,
      Math.max(primitive.start.x, primitive.end.x) + primitive.radius,
      Math.max(primitive.start.y, primitive.end.y) + primitive.radius,
    )
  }
  index.finish()
  return index
}

function getCopperBlockers(
  {
    point,
    includeClearance,
  }: {
    point: Pick<PortPoint, "x" | "y" | "z">
    includeClearance?: boolean
  },
  { index, traceWidth, clearance }: CopperLookupContext,
): PreloadedHighDensityRoute[] {
  let radius = traceWidth / 2
  if (includeClearance !== false) radius += clearance
  const nearbyCopper = index?.search(
    point.x - radius,
    point.y - radius,
    point.x + radius,
    point.y + radius,
  ) ?? []
  const blockers: PreloadedHighDensityRoute[] = []
  for (const primitive of nearbyCopper) {
    const isOnLayer = point.z >= primitive.minZ && point.z <= primitive.maxZ
    if (!isOnLayer) continue
    const distance = pointToSegmentDistance(
      point,
      primitive.start,
      primitive.end,
    )
    if (distance < primitive.radius + radius) blockers.push(primitive.route)
  }
  return blockers
}

function getClearCopperSpans(
  segment: CopperSegment,
  { index, padIndex, layerCount, traceWidth, clearance, connMap, activeNets }: CopperLookupContext,
): Array<[number, number]> {
  const { start, end, z } = segment
  const radius = traceWidth / 2 + clearance
  const nearbyCopper = index?.search(
    Math.min(start.x, end.x) - radius,
    Math.min(start.y, end.y) - radius,
    Math.max(start.x, end.x) + radius,
    Math.max(start.y, end.y) + radius,
  ) ?? []
  const intervals: Array<[number, number]> = []
  for (const primitive of nearbyCopper) {
    if (!primitive.route.isFixed) continue
    if (segment.connectionName && arePipeline9RoutesOnSameNet({ left: { ...segment, connectionName: segment.connectionName }, right: primitive.route }, connMap)) continue
    if (z < primitive.minZ || z > primitive.maxZ) continue
    const interval = getSegmentCapsuleInterval({
      start,
      end,
      capsuleStart: primitive.start,
      capsuleEnd: primitive.end,
      radius: primitive.radius + radius,
    })
    if (interval) intervals.push(interval)
  }
  if (padIndex) {
    const layer = mapZToLayerName(z, layerCount)
    const pads = padIndex.search(
      Math.min(start.x, end.x) - radius, Math.min(start.y, end.y) - radius,
      Math.max(start.x, end.x) + radius, Math.max(start.y, end.y) + radius,
    )
    for (const obstacle of pads) {
      // Unassigned portals retain the native-pad policy. Saved copper already
      // has an exact capsule index above; mesh approximation boxes are not pads.
      if (!segment.connectionName && !obstacle.circuitJsonMetadata?.pcb_smtpad_id &&
        !obstacle.circuitJsonMetadata?.pcb_plated_hole_id) continue
      if (!obstacle.isNonPlatedHole && !obstacle.layers.includes(layer)) continue
      if (segment.connectionName
        ? isObstacleConnectedToRoute(obstacle, { ...segment, connectionName: segment.connectionName }, connMap)
        : obstacle.connectedTo.some((id) => activeNets.has(connMap.getNetConnectedToId(id) ?? id))) continue
      const interval = getSegmentObstacleClearanceInterval({ start, end, obstacle, margin: radius })
      if (interval) intervals.push(interval)
    }
  }
  intervals.sort((a, b) => a[0] - b[0])
  const clearSpans: Array<[number, number]> = []
  let startFraction = 0
  for (const [entry, exit] of intervals) {
    if (entry > startFraction) clearSpans.push([startFraction, entry])
    startFraction = Math.max(startFraction, exit)
  }
  if (startFraction < 1) clearSpans.push([startFraction, 1])
  return clearSpans
}

/** Query saved wire and via copper in board-world mm (+X right, +Y up). */
export function createPreloadedCopperLookup(
  input: PreloadedCopperInput,
): PreloadedCopperLookup {
  const index = createPreloadedCopperIndex(input)
  const clearance =
    input.srj.minTraceToPadEdgeClearance ??
    input.srj.defaultObstacleMargin ??
    RELAXED_DRC_OPTIONS.traceClearance
  const activeNets = new Set(
    input.srj.connections.map(({ name }) =>
      input.connMap.getNetConnectedToId(name) ?? name,
    ),
  )
  const pads = input.srj.obstacles
  let padIndex: FlatbushIndex<Obstacle> | undefined
  if (pads.length > 0) {
    padIndex = new FlatbushIndex(pads.length)
    for (const pad of pads) {
      const bounds = getBoundingBox(pad)
      padIndex.insert(pad, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)
    }
    padIndex.finish()
  }
  const context: CopperLookupContext = {
    index,
    connMap: input.connMap,
    activeNets,
    padIndex,
    layerCount: input.srj.layerCount,
    traceWidth: input.traceWidth,
    clearance,
  }
  return {
    getBlockers: (point, options): PreloadedHighDensityRoute[] =>
      getCopperBlockers(
        { point, includeClearance: options?.includeClearance },
        context,
      ),
    getClearSpans: (segment): Array<[number, number]> =>
      getClearCopperSpans(segment, context),
  }
}
