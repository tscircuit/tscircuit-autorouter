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
 * Select safe sections from repair04's junction-preserving projection.
 * Validate neighboring moves together, then restore blocked sections until
 * every retained move clears the copper that will actually be published.
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
  const sections: {
    routeIndex: number
    startIndex: number
    endIndex: number
  }[] = []
  for (const [ri, projected] of proposedRoutes.entries()) {
    const original = routes[ri]!
    if (projected.route.length !== original.route.length) {
      throw new Error("Partial clearance projection changed routing topology")
    }
    const names = [traces[ri]!.pcb_trace_id]
    if (resolver.canonicalize(names).some((net) => protectedNets.has(net))) {
      continue
    }
    // Keep the original via metadata: this pass only moves wires.
    selected[ri] = { ...original, route: [...projected.route] }
    let pointIndex = 0
    while (pointIndex < projected.route.length) {
      const startIndex = pointIndex
      while (
        pointIndex < projected.route.length &&
        (projected.route[pointIndex]!.x !== original.route[pointIndex]!.x ||
          projected.route[pointIndex]!.y !== original.route[pointIndex]!.y)
      ) {
        pointIndex++
      }
      if (pointIndex === startIndex) {
        pointIndex++
        continue
      }
      sections.push({
        routeIndex: ri,
        startIndex,
        endIndex: pointIndex,
      })
    }
  }
  let index = new SpatialObstacleIndex(
    indexInput,
    selected.map(toTrace),
    undefined,
    [],
    resolver,
  )
  const isSectionClear = ({
    routeIndex,
    startIndex,
    endIndex,
  }: (typeof sections)[number]): boolean => {
    const proposed = proposedRoutes[routeIndex]!
    // Include both boundary segments of each moved section.
    for (
      let pi = Math.max(1, startIndex);
      pi <= Math.min(endIndex, proposed.route.length - 1);
      pi++
    ) {
      const a = proposed.route[pi - 1]!
      const b = proposed.route[pi]!
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
          connectionNames: [traces[routeIndex]!.pcb_trace_id],
        })
      ) {
        return false
      }
    }
    return true
  }
  // A move may need its neighbor to move too. Validate the proposed geometry
  // together instead of rejecting the first move against old neighbor copper.
  let pending = sections
  while (pending.length > 0) {
    const blocked = pending.filter((section) => !isSectionClear(section))
    if (blocked.length === 0) break
    // A restored section can obstruct a move accepted in this round. Rebuild
    // the index and recheck survivors before publishing anything. Each round
    // removes at least one section, so this process is bounded by their count.
    for (const { routeIndex, startIndex, endIndex } of blocked) {
      for (let pi = startIndex; pi < endIndex; pi++) {
        selected[routeIndex]!.route[pi] = routes[routeIndex]!.route[pi]!
      }
    }
    const rejected = new Set(blocked)
    pending = pending.filter((section) => !rejected.has(section))
    index = new SpatialObstacleIndex(
      indexInput,
      selected.map(toTrace),
      undefined,
      [],
      resolver,
    )
  }
  // Conflicting proposals may have blocked each other even though one clears
  // the restored neighbor. Reconsider each rejected section once, retaining
  // only individually clear moves against the already accepted copper.
  const accepted = new Set(pending)
  for (const section of sections) {
    if (accepted.has(section) || !isSectionClear(section)) continue
    const { routeIndex, startIndex, endIndex } = section
    for (let pi = startIndex; pi < endIndex; pi++) {
      selected[routeIndex]!.route[pi] = proposedRoutes[routeIndex]!.route[pi]!
    }
    accepted.add(section)
    index = new SpatialObstacleIndex(
      indexInput,
      selected.map(toTrace),
      undefined,
      [],
      resolver,
    )
  }
  const acceptedRouteIndices = new Set(
    [...accepted].map(({ routeIndex }) => routeIndex),
  )
  return selected.map((route, routeIndex) =>
    acceptedRouteIndices.has(routeIndex) ? route : routes[routeIndex]!,
  )
}
