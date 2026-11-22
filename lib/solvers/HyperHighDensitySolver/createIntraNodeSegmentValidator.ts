import type { ConnectionName } from "lib/types/srj-types"
import type { StaticSegmentValidator } from "@tscircuit/high-density-a01"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9RouteCopperGeometry,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

type IntraNodeCopperInput = {
  allowedZLayersByConnectionName?: ReadonlyMap<ConnectionName, readonly number[]>
  fixedHdRoutes: HighDensityRoute[]
  connMap: ConnectivityMap
  layerCount: number
  clearance: number
  allowBlindAndBuriedVias?: boolean
}

type IntraNodeCopperContext = Omit<IntraNodeCopperInput, "fixedHdRoutes"> & {
  index: FlatbushIndex<HighDensityRoute>
}

function isIntraNodeSegmentOnAllowedLayer(
  segment: Parameters<StaticSegmentValidator>[0],
  { allowedZLayersByConnectionName }: Pick<
    IntraNodeCopperInput,
    "allowedZLayersByConnectionName"
  >,
): boolean {
  const allowedZLayers = allowedZLayersByConnectionName?.get(
    segment.connectionName,
  )
  if (!allowedZLayers) return true
  if (segment.start.z !== segment.end.z) return true
  if (segment.start.x === segment.end.x && segment.start.y === segment.end.y) {
    return true
  }
  return allowedZLayers.includes(segment.start.z)
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
  if (copper.length === 0) {
    return (segment): boolean => isIntraNodeSegmentOnAllowedLayer(segment, input)
  }
  const index = new FlatbushIndex<HighDensityRoute>(copper.length)
  for (const primitive of copper) {
    index.insert(
      primitive.route,
      Math.min(primitive.start.x, primitive.end.x) - primitive.radius,
      Math.min(primitive.start.y, primitive.end.y) - primitive.radius,
      Math.max(primitive.start.x, primitive.end.x) + primitive.radius,
      Math.max(primitive.start.y, primitive.end.y) + primitive.radius,
    )
  }
  index.finish()
  const context: IntraNodeCopperContext = { ...input, index }
  if (!input.allowedZLayersByConnectionName?.size) {
    return (segment): boolean => isIntraNodeSegmentClear(segment, context)
  }
  return (segment): boolean =>
    isIntraNodeSegmentOnAllowedLayer(segment, input) &&
    isIntraNodeSegmentClear(segment, context)
}
