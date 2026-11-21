import type { Point } from "@tscircuit/math-utils"
import type {
  NetId,
  SimpleRouteJson,
  SimplifiedPcbTrace,
  TraceId,
} from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type ViaRoutePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "via" }
>

export type PreloadedTracePrimitive = {
  traceId: TraceId
  fixedNetId: NetId
  isFixed?: boolean
  routePositionStart: number
  routePositionEnd: number
  zLayers: number[]
  start: Point
  end: Point
}

export const PRELOADED_TRACE_TOLERANCE = 1e-6

function getLayersBetween(
  { from_layer, to_layer }: Pick<ViaRoutePoint, "from_layer" | "to_layer">,
  layerCount: number,
): number[] {
  const fromZ = mapLayerNameToZ(from_layer, layerCount)
  const toZ = mapLayerNameToZ(to_layer, layerCount)
  return Array.from(
    { length: Math.abs(toZ - fromZ) + 1 },
    (_, index) => Math.min(fromZ, toZ) + index,
  )
}

const getPreloadedViaLayers = ({
  via,
  srj,
}: {
  via: ViaRoutePoint
  srj: Pick<SimpleRouteJson, "layerCount" | "allowBlindAndBuriedVias">
}): number[] => {
  if (srj.allowBlindAndBuriedVias !== true) {
    return Array.from({ length: srj.layerCount }, (_, z) => z)
  }
  if (via.layers !== undefined) {
    return via.layers.map((layer) => mapLayerNameToZ(layer, srj.layerCount))
  }
  return getLayersBetween(via, srj.layerCount)
}

/** Convert saved copper to layer-specific points and segments in route order. */
export function getPreloadedTracePrimitives(
  srj: SimpleRouteJson,
): PreloadedTracePrimitive[] {
  const primitives: PreloadedTracePrimitive[] = []
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)

  for (const trace of srj.traces ?? []) {
    if (!trace.connection_name) {
      throw new Error(
        `Preloaded trace "${trace.pcb_trace_id}" is missing a connection name`,
      )
    }
    const fixedNetId =
      connMap.getNetConnectedToId(trace.connection_name) ??
      trace.connection_name

    const preloadedTrace = {
      traceId: trace.pcb_trace_id,
      fixedNetId,
      isFixed: trace.isFixed,
    }

    for (const [routePosition, routePoint] of trace.route.entries()) {
      if (routePoint.route_type === "via") {
        primitives.push({
          ...preloadedTrace,
          routePositionStart: routePosition,
          routePositionEnd: routePosition,
          zLayers: getPreloadedViaLayers({ via: routePoint, srj }),
          start: routePoint,
          end: routePoint,
        })
      } else if (routePoint.route_type === "through_obstacle") {
        primitives.push({
          ...preloadedTrace,
          routePositionStart: routePosition,
          routePositionEnd: routePosition + 1,
          zLayers: getLayersBetween(routePoint, srj.layerCount),
          start: routePoint.start,
          end: routePoint.end,
        })
      } else if (routePoint.route_type === "jumper") {
        const z = mapLayerNameToZ(routePoint.layer, srj.layerCount)
        for (const [padIndex, padCenter] of [
          routePoint.start,
          routePoint.end,
        ].entries()) {
          primitives.push({
            ...preloadedTrace,
            routePositionStart: routePosition + padIndex,
            routePositionEnd: routePosition + padIndex,
            zLayers: [z],
            start: padCenter,
            end: padCenter,
          })
        }
      }
    }

    for (
      let pointIndex = 0;
      pointIndex < trace.route.length - 1;
      pointIndex++
    ) {
      const start = trace.route[pointIndex]!
      const end = trace.route[pointIndex + 1]!
      if (
        start.route_type !== "wire" ||
        end.route_type !== "wire" ||
        start.layer !== end.layer
      ) {
        continue
      }
      primitives.push({
        ...preloadedTrace,
        routePositionStart: pointIndex,
        routePositionEnd: pointIndex + 1,
        zLayers: [mapLayerNameToZ(start.layer, srj.layerCount)],
        start,
        end,
      })
    }
  }

  return primitives
}
