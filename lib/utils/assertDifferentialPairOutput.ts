import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSimplifiedPcbTraceToHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/convertSimplifiedPcbTraceToHighDensityRoute"
import { assertDifferentialPairRoutes } from "./assertDifferentialPairRoutes"
import { getConnectivityMapFromSimpleRouteJson } from "./getConnectivityMapFromSimpleRouteJson"

/** Recheck the geometry that will be emitted, after conversion and power expansion. */
export const assertDifferentialPairOutput = (
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTraces,
): void => {
  if (!srj.differentialPairs?.length) return
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const routes = traces.map((trace) => ({
    ...convertSimplifiedPcbTraceToHighDensityRoute(trace, {
      layerCount: srj.layerCount,
      defaultTraceThickness: srj.minTraceWidth,
      defaultViaDiameter: 0.3,
      rootConnectionName:
        connMap.getNetConnectedToId(trace.connection_name) ??
        trace.connection_name,
    }),
    connectionName: trace.connection_name,
  }))
  assertDifferentialPairRoutes(
    { ...srj, differentialPairs: srj.differentialPairs },
    routes,
    true,
  )
}
