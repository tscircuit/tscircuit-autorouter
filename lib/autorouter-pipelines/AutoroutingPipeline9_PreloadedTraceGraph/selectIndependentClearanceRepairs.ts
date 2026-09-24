import {
  ConnectionNameResolver,
  SpatialObstacleIndex,
  type PowerTraceExpanderInput,
} from "@tscircuit/power-trace-expander"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

/**
 * Select proposals from repair04's junction-preserving projection. This does
 * not generate moves: a route is accepted only when every changed segment is
 * clear of all foreign copper, including previously accepted proposals.
 * Unchanged conflicts may remain; changed copper cannot trade one for another.
 */
export const selectIndependentClearanceRepairs = ({
  srj,
  routes,
  proposedRoutes,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  proposedRoutes: HighDensityRoute[]
}): HighDensityRoute[] => {
  if (routes.length !== proposedRoutes.length) {
    throw new Error("Clearance projection changed the route count")
  }
  // The index represents ordinary wires and through vias. Leave unsupported
  // copper to the existing complete-repair path and its reference checks.
  if (
    srj.allowBlindAndBuriedVias ||
    routes.some(
      (route) =>
        route.jumpers?.length ||
        route.route.some(
          (point) => point.toNextSegmentType || point.insideJumperPad,
        ),
    )
  ) {
    return routes
  }
  const { holeDiameter } = getViaDimensions(srj)
  const toTrace = (
    route: HighDensityRoute,
    index: number,
  ): NonNullable<PowerTraceExpanderInput["traces"]>[number] => ({
    type: "pcb_trace",
    pcb_trace_id: `projection_${index}`,
    connection_name: route.rootConnectionName ?? route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, srj.layerCount, {
      defaultViaHoleDiameter: holeDiameter,
    }),
  })
  const traces = routes.map(toTrace)
  const indexInput: PowerTraceExpanderInput = {
    ...srj,
    minBoardEdgeClearance: srj.minBoardEdgeClearance ?? 0,
    traces,
  } as PowerTraceExpanderInput
  const resolver = new ConnectionNameResolver(indexInput)
  const protectedNets = new Set(
    resolver.canonicalize([
      ...(srj.differentialPairs ?? []).flatMap((pair) => pair.connectionNames),
      ...(srj.buses ?? []).flatMap((bus) => bus.connectionNames),
    ]),
  )
  const selected = [...routes]
  let index = new SpatialObstacleIndex(
    indexInput,
    traces,
    undefined,
    [],
    resolver,
  )
  for (const [ri, projected] of proposedRoutes.entries()) {
    const original = routes[ri]!
    if (projected.route.length !== original.route.length) {
      throw new Error("Partial clearance projection changed routing topology")
    }
    // repair04 rebuilds its via list from transitions. Keep the input's explicit
    // via metadata (including repeated sites) because this pass only moves wires.
    const proposed = { ...original, route: projected.route }
    const names = [traces[ri]!.pcb_trace_id]
    if (resolver.canonicalize(names).some((net) => protectedNets.has(net))) {
      continue
    }
    let changed = false
    let blocked = false
    for (let pi = 1; pi < proposed.route.length; pi++) {
      const a = proposed.route[pi - 1]!
      const b = proposed.route[pi]!
      const oldA = original.route[pi - 1]!
      const oldB = original.route[pi]!
      if (
        a.x === oldA.x &&
        a.y === oldA.y &&
        b.x === oldB.x &&
        b.y === oldB.y
      ) continue
      changed = true
      if (a.z !== b.z) {
        throw new Error("Partial clearance projection moved a layer transition")
      }
      if (
        index.collides({
          start: a,
          end: b,
          layer: mapZToLayerName(a.z, srj.layerCount),
          width: Math.max(
            a.traceThickness ?? proposed.traceThickness,
            b.traceThickness ?? proposed.traceThickness,
          ),
          connectionNames: names,
        })
      ) {
        blocked = true
        break
      }
    }
    if (!changed || blocked) continue
    selected[ri] = proposed
    traces[ri] = toTrace(proposed, ri)
    index = new SpatialObstacleIndex(indexInput, traces, undefined, [], resolver)
  }
  return selected
}
