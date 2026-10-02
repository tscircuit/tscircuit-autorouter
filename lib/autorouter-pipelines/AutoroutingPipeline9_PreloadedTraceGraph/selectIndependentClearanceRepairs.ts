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
 * Select safe bends from repair04's junction-preserving projection.
 * Validate neighboring moves together, then restore blocked vertices until
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

  const movedPoints: {
    routeIndex: number
    pointIndex: number
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

    for (
      let pointIndex = 0;
      pointIndex < projected.route.length;
      pointIndex++
    ) {
      if (
        projected.route[pointIndex]!.x !== original.route[pointIndex]!.x ||
        projected.route[pointIndex]!.y !== original.route[pointIndex]!.y
      ) {
        movedPoints.push({ routeIndex: ri, pointIndex })
      }
    }
  }

  let index = new SpatialObstacleIndex(
    indexInput,
    selected.map(toTrace),
    undefined,
    [],
    resolver,
  )

  const isPointClear = ({
    routeIndex,
    pointIndex,
  }: (typeof movedPoints)[number]): boolean => {
    const selectedRoute = selected[routeIndex]!

    // Check both incident segments against the coordinates actually retained.
    // A restored neighbor changes these segments even if this point stays put.
    for (
      let pi = Math.max(1, pointIndex);
      pi <= Math.min(pointIndex + 1, selectedRoute.route.length - 1);
      pi++
    ) {
      const a = selectedRoute.route[pi - 1]!
      const b = selectedRoute.route[pi]!

      if (a.z !== b.z) {
        throw new Error("Partial clearance projection moved a layer transition")
      }

      if (
        index.collides({
          start: a,
          end: b,
          layer: mapZToLayerName(a.z, srj.layerCount),
          width: Math.max(
            a.traceThickness ?? selectedRoute.traceThickness,
            b.traceThickness ?? selectedRoute.traceThickness,
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
  let pending = movedPoints

  while (pending.length > 0) {
    const blocked = pending.filter((point): boolean => !isPointClear(point))

    if (blocked.length === 0) break

    // A restored vertex can obstruct a move accepted in this round. Rebuild
    // the index and recheck survivors before publishing anything. Each round
    // removes at least one vertex, so this process is bounded by their count.
    for (const { routeIndex, pointIndex } of blocked) {
      selected[routeIndex]!.route[pointIndex] =
        routes[routeIndex]!.route[pointIndex]!
    }

    const rejected = new Set(blocked)
    pending = pending.filter((point): boolean => !rejected.has(point))
    index = new SpatialObstacleIndex(
      indexInput,
      selected.map(toTrace),
      undefined,
      [],
      resolver,
    )
  }

  // Conflicting proposals may have blocked each other even though one clears
  // the restored neighbor. Reconsider contiguous rejected points together so
  // bends that need both segment endpoints to move are not lost here.
  const accepted = new Set(pending)

  for (let offset = 0; offset < movedPoints.length; offset++) {
    const first = movedPoints[offset]!

    if (accepted.has(first)) continue
    let reconsidered = [first]

    while (offset + 1 < movedPoints.length) {
      const next = movedPoints[offset + 1]!

      if (
        accepted.has(next) ||
        next.routeIndex !== first.routeIndex ||
        next.pointIndex !== movedPoints[offset]!.pointIndex + 1
      ) {
        break
      }

      reconsidered.push(next)
      offset++
    }

    for (const { routeIndex, pointIndex } of reconsidered) {
      selected[routeIndex]!.route[pointIndex] =
        proposedRoutes[routeIndex]!.route[pointIndex]!
    }

    while (reconsidered.length > 0) {
      const blocked = reconsidered.filter(
        (point): boolean => !isPointClear(point),
      )

      if (blocked.length === 0) break

      for (const { routeIndex, pointIndex } of blocked) {
        selected[routeIndex]!.route[pointIndex] =
          routes[routeIndex]!.route[pointIndex]!
      }

      const rejected = new Set(blocked)
      reconsidered = reconsidered.filter(
        (point): boolean => !rejected.has(point),
      )
    }

    if (reconsidered.length === 0) continue

    for (const point of reconsidered) accepted.add(point)
    // Only this route changed during reconsideration. Its own net is excluded
    // from collision queries, so rebuild once before testing another route.
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
