import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSimplifiedPcbTraceToHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/convertSimplifiedPcbTraceToHighDensityRoute"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { DifferentialPairRoutingError } from "./DifferentialPairRoutingError"
import { assertDifferentialPairRoutes } from "./assertDifferentialPairRoutes"
import { getConnectivityMapFromSimpleRouteJson } from "./getConnectivityMapFromSimpleRouteJson"

/** Recheck the geometry that will be emitted, after conversion and power expansion. */
export const assertDifferentialPairOutput = (
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTraces,
): void => {
  if (!srj.differentialPairs?.length) return
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const ownedNames = new Set(
    srj.differentialPairs.flatMap((pair): string[] =>
      pair.connectionNames.flat(),
    ),
  )
  for (const trace of traces) {
    if (!ownedNames.has(trace.connection_name)) continue
    const pairIndex = srj.differentialPairs.findIndex((pair): boolean =>
      pair.connectionNames.flat().includes(trace.connection_name),
    )
    const connection = srj.connections.find(
      (connection): boolean => connection.name === trace.connection_name,
    )
    if (!connection || trace.source_trace_id !== connection.source_trace_id)
      throw new DifferentialPairRoutingError(
        {
          reason: "ownership_violation",
          pairIndex,
          connectionName: trace.connection_name,
        },
        `hop "${trace.connection_name}" lost source provenance`,
      )
    const endpointIds = connection.pointsToConnect.flatMap(
      (point): string[] => {
        const id = point.pointId ?? point.pcb_port_id
        return id ? [id] : []
      },
    )
    if (endpointIds.some((id): boolean => !trace.connectsTo?.includes(id)))
      throw new DifferentialPairRoutingError(
        {
          reason: "ownership_violation",
          pairIndex,
          connectionName: trace.connection_name,
        },
        `hop "${trace.connection_name}" lost endpoint identities`,
      )
  }
  const replacedIds = new Set(
    traces.flatMap((trace): string[] => [
      trace.pcb_trace_id,
      ...(trace.__replaces_pcb_trace_id ? [trace.__replaces_pcb_trace_id] : []),
    ]),
  )
  const finalCopper = [
    ...(srj.traces ?? []).filter(
      (trace): boolean => !replacedIds.has(trace.pcb_trace_id),
    ),
    ...traces,
  ]
  const routes = finalCopper.map(
    (trace): HighDensityRoute => ({
      ...convertSimplifiedPcbTraceToHighDensityRoute(trace, {
        layerCount: srj.layerCount,
        defaultTraceThickness: srj.minTraceWidth,
        defaultViaDiameter: 0.3,
        rootConnectionName:
          connMap.getNetConnectedToId(trace.connection_name) ??
          trace.connection_name,
      }),
      connectionName: trace.connection_name,
    }),
  )
  assertDifferentialPairRoutes(
    { ...srj, differentialPairs: srj.differentialPairs },
    routes,
    true,
  )
}
