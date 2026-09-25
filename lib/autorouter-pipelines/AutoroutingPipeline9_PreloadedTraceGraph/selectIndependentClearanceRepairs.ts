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
 * not generate moves: a section is accepted only when every changed segment is
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
  // A later accepted section can clear a previously blocked proposal. Revisit
  // the remaining sections until none can be accepted. Every accepted vertex
  // takes its one fixed proposed position, so this cannot oscillate.
  let madeProgress: boolean
  do {
    madeProgress = false
    for (const [ri, projected] of proposedRoutes.entries()) {
      const original = selected[ri]!
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
      const route = [...original.route]
      let accepted = false
      let pointIndex = 0
      while (pointIndex < proposed.route.length) {
        const startIndex = pointIndex
        while (
          pointIndex < proposed.route.length &&
          (proposed.route[pointIndex]!.x !== original.route[pointIndex]!.x ||
            proposed.route[pointIndex]!.y !== original.route[pointIndex]!.y)
        ) {
          pointIndex++
        }
        if (pointIndex === startIndex) {
          pointIndex++
          continue
        }
        const endIndex = pointIndex
        // Adjacent moved vertices share segments and must be accepted together.
        // An unchanged vertex separates independent sections. Include the two
        // boundary segments so retaining one section cannot leave an unchecked gap.
        let blocked = false
        for (
          let pi = Math.max(1, startIndex);
          pi <= Math.min(endIndex, proposed.route.length - 1);
          pi++
        ) {
          const a = proposed.route[pi - 1]!
          const b = proposed.route[pi]!
          if (a.z !== b.z) {
            throw new Error(
              "Partial clearance projection moved a layer transition",
            )
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
        if (blocked) continue
        for (let pi = startIndex; pi < endIndex; pi++) {
          route[pi] = proposed.route[pi]!
        }
        accepted = true
      }
      if (!accepted) continue
      madeProgress = true
      selected[ri] = { ...proposed, route }
      traces[ri] = toTrace(selected[ri]!, ri)
      index = new SpatialObstacleIndex(
        indexInput,
        traces,
        undefined,
        [],
        resolver,
      )
    }
  } while (madeProgress)
  return selected
}
