import type { ConnectionPoint, SimpleRouteJson } from "lib/types"
import { isSingleLayerConnectionPoint } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"

/** A virtual handoff on existing same-net copper can use its actual via span.
 * Physical SMT terminals retain their declared layers and via-in-pad policy. */
export function getSrjWithFixedViaHandoffLayers(
  srj: SimpleRouteJson,
): SimpleRouteJson {
  const traces = srj.traces
  if (!traces?.some((trace) => trace.isFixed)) return srj
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const viaDiameter = getViaDimensions(srj).padDiameter
  return {
    ...srj,
    connections: srj.connections.map((connection) => ({
      ...connection,
      pointsToConnect: connection.pointsToConnect.map((point): ConnectionPoint => {
        const pointId = point.pointId
        if (
          point.pcb_port_id ||
          !pointId ||
          !isSingleLayerConnectionPoint(point) ||
          point.terminalVia
        ) return point
        const net = connMap.getNetConnectedToId(connection.name)
        if (net === undefined) {
          throw new Error(`No net found for handoff "${pointId}"`)
        }
        const traceIndex = traces.findIndex((trace) =>
          trace.isFixed &&
          trace.connectsTo?.includes(pointId) &&
          connMap.getNetConnectedToId(trace.connection_name) === net &&
          trace.route.some((part) =>
            part.route_type === "via" &&
            Math.hypot(part.x - point.x, part.y - point.y) < 1e-6,
          ),
        )
        if (traceIndex < 0) return point
        const routes = convertPreloadedTraceToHdRoutes(
          traces[traceIndex]!, traceIndex, srj.layerCount, viaDiameter, connMap,
        )
        const via = routes.flatMap((route) =>
          getPipeline9RouteCopperGeometry(route, srj).viaSpans,
        ).find((candidate) =>
          Math.hypot(candidate.center.x - point.x, candidate.center.y - point.y) < 1e-6,
        )
        if (!via) throw new Error("Fixed via handoff lost its physical copper span")
        const layers = Array.from(
          { length: via.maxZ - via.minZ + 1 },
          (_, index) => mapZToLayerName(via.minZ + index, srj.layerCount),
        )
        if (!layers.some((layer) => layer === point.layer)) {
          throw new Error(`Handoff "${pointId}" is outside its connected via span`)
        }
        const { layer, terminalVia, ...terminal } = point
        return { ...terminal, layers }
      }),
    })),
  }
}
