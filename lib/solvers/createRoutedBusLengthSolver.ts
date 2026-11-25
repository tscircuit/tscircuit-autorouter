import { RoutedBusLengthSolver, type Trace } from "@tscircuit/bus-lanes-solver"
import { convertSimplifiedPcbTraceToHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/convertSimplifiedPcbTraceToHighDensityRoute"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

function toBusTrace(
  trace: SimplifiedPcbTrace,
  throughViaLayers?: string[],
): Trace {
  const route: Trace["route"] = trace.route.map((point) => {
    if (point.route_type === "wire") return point
    if (point.route_type === "via") {
      return { ...point, layers: point.layers ?? throughViaLayers }
    }
    throw new Error(
      `Length matching does not support ${point.route_type} on ${trace.pcb_trace_id}`,
    )
  })
  return { ...trace, route }
}

export function createRoutedBusLengthSolver({
  srj,
  hdRoutes,
  fixedTraces,
}: {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  fixedTraces: SimpleRouteJson["traces"]
}): { solver: RoutedBusLengthSolver; getMatchedHdRoutes(): HighDensityRoute[] } {
  const throughViaLayers = srj.allowBlindAndBuriedVias
    ? undefined
    : Array.from({ length: srj.layerCount }, (_, z) =>
        mapZToLayerName(z, srj.layerCount),
      )
  const routedTraces = hdRoutes.map((hdRoute) =>
    toBusTrace(
      {
        type: "pcb_trace",
        pcb_trace_id: hdRoute.connectionName,
        connection_name: hdRoute.rootConnectionName ?? hdRoute.connectionName,
        route: convertHdRouteToSimplifiedRoute(hdRoute, srj.layerCount, {
          defaultViaHoleDiameter: srj.minViaHoleDiameter,
        }),
      },
      throughViaLayers,
    ),
  )
  const connections = srj.connections.map((connection) => {
    const endpoints = routedTraces
      .filter((trace) => trace.connection_name === connection.name)
      .flatMap((trace) => [trace.route[0], trace.route.at(-1)])
    return {
      ...connection,
      pointsToConnect: connection.pointsToConnect.map((point) => {
        if (point.layer !== undefined) return point
        const endpoint = endpoints.find(
          (end) =>
            end?.route_type === "wire" &&
            point.layers.includes(end.layer) &&
            Math.hypot(point.x - end.x, point.y - end.y) < 1e-6,
        )
        if (endpoint?.route_type !== "wire")
          throw new Error(`No routed terminal layer on ${connection.name}`)
        return { ...point, layer: endpoint.layer }
      }),
    }
  })
  const solver = new RoutedBusLengthSolver({
    input: {
      ...srj,
      connections,
      buses: srj.buses?.map((bus) => ({
        ...bus,
        referenceConnectionNames: bus.lengthMatchToConnectionNames,
        skewReference: "range",
      })),
      traces: (fixedTraces ?? srj.traces ?? []).map((trace) =>
        toBusTrace(trace, throughViaLayers),
      ),
    },
    routedTraces,
    fixedConnectionNames: srj.differentialPairs?.flatMap(
      (pair) => pair.connectionNames,
    ),
  })
  return {
    solver,
    getMatchedHdRoutes(): HighDensityRoute[] {
      const { traces } = solver.getOutput()
      return hdRoutes.map((hdRoute, index) => {
        const trace = traces[index]
        if (trace === routedTraces[index]) return hdRoute
        const matched = convertSimplifiedPcbTraceToHighDensityRoute(
          { ...trace, connection_name: hdRoute.connectionName },
          {
            layerCount: srj.layerCount,
            rootConnectionName:
              hdRoute.rootConnectionName ?? hdRoute.connectionName,
            defaultTraceThickness: hdRoute.traceThickness,
            defaultViaDiameter: hdRoute.viaDiameter,
          },
        )
        const first = matched.route[0]
        const last = matched.route.at(-1)
        if (first) first.pcb_port_id = hdRoute.startPcbPortId
        if (last) last.pcb_port_id = hdRoute.endPcbPortId
        return {
          ...hdRoute,
          traceThickness: matched.traceThickness,
          route: matched.route,
          vias: matched.vias,
        }
      })
    },
  }
}
