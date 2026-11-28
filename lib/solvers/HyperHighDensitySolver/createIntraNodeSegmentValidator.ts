import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { Obstacle } from "lib/types"
import { getSegmentToObstacleDistance } from "lib/utils/getSegmentToObstacleDistance"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import type { StaticSegmentValidator } from "@tscircuit/high-density-a01"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9RouteCopperGeometry,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute, PortPoint } from "lib/types/high-density-types"

export type ReservedRoutingTerminal = PortPoint & { traceThickness: number }

type IntraNodeCopperInput = {
  reservedTerminals?: readonly ReservedRoutingTerminal[]
  fixedHdRoutes: HighDensityRoute[]
  obstacles?: Obstacle[]
  connMap: ConnectivityMap
  layerCount: number
  clearance: number
  viaHoleDiameter?: number
  allowViaInPad?: boolean
  allowBlindAndBuriedVias?: boolean
}

type IntraNodeCopperContext = Omit<IntraNodeCopperInput, "fixedHdRoutes"> & {
  index?: FlatbushIndex<HighDensityRoute>
}

function isIntraNodeSegmentClear(
  segment: Parameters<StaticSegmentValidator>[0],
  {
    index,
    connMap,
    layerCount,
    clearance,
    allowBlindAndBuriedVias,
  }: IntraNodeCopperContext,
): boolean {
  const route: HighDensityRoute = {
    ...segment,
    route: [segment.start, segment.end],
    vias: [],
  }
  const isVia = segment.start.z !== segment.end.z
  if (isVia) route.vias.push(segment.start)
  let copperRadius = segment.traceThickness / 2
  if (isVia) {
    copperRadius = Math.max(copperRadius, segment.viaDiameter / 2)
  }
  const radius = copperRadius + clearance
  const bounds = {
    minX: Math.min(segment.start.x, segment.end.x) - radius,
    maxX: Math.max(segment.start.x, segment.end.x) + radius,
    minY: Math.min(segment.start.y, segment.end.y) - radius,
    maxY: Math.max(segment.start.y, segment.end.y) + radius,
  }
  if (!index) return true
  const nearbyRoutes = new Set(
    index.search(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY),
  )
  for (const fixed of nearbyRoutes) {
    if (arePipeline9RoutesOnSameNet({ left: route, right: fixed }, connMap)) {
      continue
    }
    if (
      doPipeline9RoutesHaveCopperConflict({
        left: fixed,
        right: route,
        leftBounds: bounds,
        clearance,
        layerCount,
        allowBlindAndBuriedVias,
      })
    ) {
      return false
    }
  }
  return true
}

/** Reuse native copper validation while A03 searches in physical coordinates. */
export function createIntraNodeSegmentValidator(
  input: IntraNodeCopperInput,
): StaticSegmentValidator {
  const copper = input.fixedHdRoutes.flatMap((route) => {
    const geometry = getPipeline9RouteCopperGeometry(route, input)
    return [
      ...geometry.wireSegments.map((wire) => ({
        route,
        start: wire.start,
        end: wire.end,
        radius: wire.width / 2,
      })),
      ...geometry.viaSpans.map((via) => ({
        route,
        start: via.center,
        end: via.center,
        radius: via.diameter / 2,
      })),
    ]
  })
  const index = copper.length > 0 ? new FlatbushIndex<HighDensityRoute>(copper.length) : undefined
  for (const primitive of copper) {
    index!.insert(
      primitive.route,
      Math.min(primitive.start.x, primitive.end.x) - primitive.radius,
      Math.min(primitive.start.y, primitive.end.y) - primitive.radius,
      Math.max(primitive.start.x, primitive.end.x) + primitive.radius,
      Math.max(primitive.start.y, primitive.end.y) + primitive.radius,
    )
  }
  index?.finish()
  const obstacles = input.obstacles ?? []
  const obstacleIndex = obstacles.length > 0
    ? new FlatbushIndex<Obstacle>(obstacles.length)
    : undefined
  for (const obstacle of obstacles) {
    const radius = Math.hypot(obstacle.width, obstacle.height) / 2
    obstacleIndex!.insert(obstacle,
      obstacle.center.x - radius, obstacle.center.y - radius,
      obstacle.center.x + radius, obstacle.center.y + radius)
  }
  obstacleIndex?.finish()
  const terminals = input.reservedTerminals ?? []
  const terminalIndex = terminals.length > 0
    ? new FlatbushIndex<ReservedRoutingTerminal>(terminals.length)
    : undefined
  for (const terminal of terminals) {
    const radius = terminal.traceThickness / 2
    terminalIndex!.insert(terminal, terminal.x - radius, terminal.y - radius,
      terminal.x + radius, terminal.y + radius)
  }
  terminalIndex?.finish()
  const context: IntraNodeCopperContext = { ...input, index }
  return (segment): boolean => {
    const via = segment.start.z !== segment.end.z
    const minZ = via && !input.allowBlindAndBuriedVias ? 0 : Math.min(segment.start.z, segment.end.z)
    const maxZ = via && !input.allowBlindAndBuriedVias ? input.layerCount - 1 : Math.max(segment.start.z, segment.end.z)
    const layers = new Set<string>(Array.from({ length: maxZ - minZ + 1 }, (_, offset) => mapZToLayerName(minZ + offset, input.layerCount)))
    const width = via ? segment.viaDiameter : segment.traceThickness
    const reach = width / 2 + input.clearance
    const nearbyObstacles = obstacleIndex?.search(
      Math.min(segment.start.x, segment.end.x) - reach,
      Math.min(segment.start.y, segment.end.y) - reach,
      Math.max(segment.start.x, segment.end.x) + reach,
      Math.max(segment.start.y, segment.end.y) + reach,
    ) ?? []
    const nearbyTerminals = terminalIndex?.search(
      Math.min(segment.start.x, segment.end.x) - reach,
      Math.min(segment.start.y, segment.end.y) - reach,
      Math.max(segment.start.x, segment.end.x) + reach,
      Math.max(segment.start.y, segment.end.y) + reach,
    ) ?? []
    for (const terminal of nearbyTerminals) {
      if (terminal.z < minZ || terminal.z > maxZ ||
        arePipeline9RoutesOnSameNet({ left: segment, right: terminal }, input.connMap)) continue
      if (pointToSegmentDistance(terminal, segment.start, segment.end) <
        reach + terminal.traceThickness / 2 - 1e-9) return false
    }
    for (const obstacle of nearbyObstacles) {
      const connected = isObstacleConnectedToRoute(obstacle, segment, input.connMap)
      if (connected && (!via || input.allowViaInPad === true)) continue
      const required = connected ? (input.viaHoleDiameter ?? segment.viaDiameter / 2) / 2 : reach
      if ((obstacle.isNonPlatedHole || obstacle.layers.some((layer) => layers.has(layer))) &&
        getSegmentToObstacleDistance({start: segment.start, end: segment.end, obstacle}) < required - 1e-9
      ) return false
    }
    return isIntraNodeSegmentClear(segment, context)
  }
}
