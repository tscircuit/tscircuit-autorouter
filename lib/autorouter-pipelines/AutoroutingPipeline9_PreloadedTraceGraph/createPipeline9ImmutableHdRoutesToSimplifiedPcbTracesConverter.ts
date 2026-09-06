import {
  createPipeline7HdRoutesToSimplifiedPcbTracesConverter,
  type ConvertPipeline7HdRoutesOptions,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import type { SimplifiedPcbTrace, SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type ImmutableHdRoutesConverter = (
  hdRoutes: HighDensityRoute[],
) => SimplifiedPcbTraces

type CachedConnectionTrace = {
  convertedTrace: SimplifiedPcbTrace
  tracesByFragmentIndex: Map<number, SimplifiedPcbTrace>
}

/**
 * Converts immutable options and HD candidates without rebuilding geometry.
 * Returned trace objects are borrowed, read-only evaluator internals: only
 * detached Circuit JSON may be passed to downstream checks or public consumers.
 */
export const createPipeline9ImmutableHdRoutesToSimplifiedPcbTracesConverter = (
  options: Omit<ConvertPipeline7HdRoutesOptions, "hdRoutes">,
): ImmutableHdRoutesConverter => {
  const convertMissingRoutes =
    createPipeline7HdRoutesToSimplifiedPcbTracesConverter(options)
  const connections = [...options.connections]
  const connectionNames = new Set(
    connections.map((connection) => connection.name),
  )
  const tracesByHdRoute = new WeakMap<
    HighDensityRoute,
    Map<number, CachedConnectionTrace>
  >()

  return (hdRoutes: HighDensityRoute[]): SimplifiedPcbTraces => {
    const routesByConnectionName = new Map<string, HighDensityRoute[]>()
    const missingRoutesByConnectionName = new Map<string, HighDensityRoute[]>()
    const missingRoutes = new Set<HighDensityRoute>()
    for (const route of hdRoutes) {
      const connectionRoutes = routesByConnectionName.get(route.connectionName)
      if (connectionRoutes) connectionRoutes.push(route)
      else routesByConnectionName.set(route.connectionName, [route])
      if (
        !connectionNames.has(route.connectionName) ||
        tracesByHdRoute.has(route) ||
        missingRoutes.has(route)
      ) {
        continue
      }
      missingRoutes.add(route)
      const missingConnectionRoutes = missingRoutesByConnectionName.get(
        route.connectionName,
      )
      if (missingConnectionRoutes) missingConnectionRoutes.push(route)
      else missingRoutesByConnectionName.set(route.connectionName, [route])
    }

    if (missingRoutes.size > 0) {
      // Geometry conversion depends on the immutable route and declaration,
      // not its position among sibling fragments. Batch each HD object once;
      // the existing converter retains all terminal, net and pad-span rules.
      const convertedTraces = convertMissingRoutes([...missingRoutes])
      let convertedIndex = 0
      for (const [connectionIndex, connection] of connections.entries()) {
        const connectionRoutes = missingRoutesByConnectionName.get(
          connection.name,
        )
        if (!connectionRoutes) continue
        for (const route of connectionRoutes) {
          const convertedTrace = convertedTraces[convertedIndex++]
          if (!convertedTrace) {
            throw new Error("Pipeline9 immutable HD conversion lost a fragment")
          }
          let connectionTraces = tracesByHdRoute.get(route)
          if (!connectionTraces) {
            connectionTraces = new Map()
            tracesByHdRoute.set(route, connectionTraces)
          }
          connectionTraces.set(connectionIndex, {
            // Own nested jumper/pad metadata rather than retaining references
            // from the HD input or prepared connection points.
            convertedTrace: structuredClone(convertedTrace),
            tracesByFragmentIndex: new Map(),
          })
        }
      }
      if (convertedIndex !== convertedTraces.length) {
        throw new Error("Pipeline9 immutable HD conversion added a fragment")
      }
    }

    const traces: SimplifiedPcbTraces = []
    for (const [connectionIndex, connection] of connections.entries()) {
      const connectionRoutes = routesByConnectionName.get(connection.name)
      if (!connectionRoutes) continue
      for (const [fragmentIndex, route] of connectionRoutes.entries()) {
        const cached = tracesByHdRoute.get(route)?.get(connectionIndex)
        if (!cached) {
          throw new Error("Pipeline9 immutable HD conversion lost its cache")
        }
        let trace = cached.tracesByFragmentIndex.get(fragmentIndex)
        if (!trace) {
          trace = {
            ...cached.convertedTrace,
            pcb_trace_id: `${connection.name}_${fragmentIndex}`,
          }
          cached.tracesByFragmentIndex.set(fragmentIndex, trace)
        }
        traces.push(trace)
      }
    }
    return traces
  }
}
