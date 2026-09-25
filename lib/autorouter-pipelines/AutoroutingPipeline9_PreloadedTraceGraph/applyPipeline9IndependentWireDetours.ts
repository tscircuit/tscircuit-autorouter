import {
  ConnectionNameResolver,
  SpatialObstacleIndex,
  type PowerTraceExpanderInput,
} from "@tscircuit/power-trace-expander"
import {
  convertRepairRoutesToTraces,
  extractRepairRegion,
  mergeRepairRegion,
  negotiateTraceClearance,
} from "@tscircuit/repair04"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { canPublishIndependentClearanceRepairs } from "./canPublishIndependentClearanceRepairs"
import { getPipeline9RouteIndexByTraceId } from "./pipeline9JointDrcRepairUtils"

/** Repair fixed-endpoint wires using repair04 with every other route immutable. */
export const applyPipeline9IndependentWireDetours = ({
  originalSrj,
  routes,
  drcEvaluator,
  maxCandidateAttempts,
  maxPathSearchNodes,
}: {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  drcEvaluator: DrcEvaluator
  maxCandidateAttempts: number
  maxPathSearchNodes: number
}): {
  routes: HighDensityRoute[]
  candidateAttempts: number
  pathSearchNodes: number
} => {
  const result = { routes, candidateAttempts: 0, pathSearchNodes: 0 }
  if (
    maxCandidateAttempts <= 0 ||
    maxPathSearchNodes <= 0 ||
    originalSrj.allowBlindAndBuriedVias ||
    originalSrj.traces?.length ||
    routes.some(
      (route) =>
        route.jumpers?.length ||
        route.route.some(
          (point) => point.toNextSegmentType || point.insideJumperPad,
        ),
    )
  ) {
    return result
  }
  const srj = {
    ...createSrjWithBoardValidObstacleLayers(originalSrj),
    traces: undefined,
  }
  const { holeDiameter } = getViaDimensions(srj)
  const toTrace = (
    route: HighDensityRoute,
    index: number,
  ): NonNullable<PowerTraceExpanderInput["traces"]>[number] => ({
    type: "pcb_trace",
    pcb_trace_id: `detour_${index}`,
    connection_name: route.rootConnectionName ?? route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, srj.layerCount, {
      defaultViaHoleDiameter: holeDiameter,
    }),
  })
  const traces = routes.map(toTrace)
  const indexInput = {
    ...srj,
    minBoardEdgeClearance: srj.minBoardEdgeClearance ?? 0,
    traces,
  } as PowerTraceExpanderInput
  const resolver = new ConnectionNameResolver(indexInput)
  const protectedNets = new Set(
    resolver.canonicalize([
      ...(srj.buses ?? []).flatMap((bus) => bus.connectionNames),
      ...(srj.differentialPairs ?? []).flatMap((pair) => pair.connectionNames),
    ]),
  )
  const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
    routes,
    newConnections: srj.connections,
    syntheticConnectionNames: new Set(),
  })
  const reference = drcEvaluator({ traces: [], routes, hdRoutes: routes })
  let errors = Array.isArray(reference) ? reference : reference.errors
  const targets = new Set<number>()
  for (const error of errors) {
    if (
      error.type !== "pcb_via_trace_clearance_error" &&
      error.type !== "pcb_pad_trace_clearance_error"
    ) {
      continue
    }
    if (typeof error.pcb_trace_id !== "string") continue
    const index = routeIndexByTraceId.get(error.pcb_trace_id)
    if (index !== undefined) targets.add(index)
  }
  for (const routeIndex of targets) {
    if (
      result.candidateAttempts >= maxCandidateAttempts ||
      result.pathSearchNodes >= maxPathSearchNodes
    ) {
      break
    }
    const original = result.routes[routeIndex]!
    // These wires have no movable vertex. Projection cannot create a detour.
    // Other topologies remain with the existing coupled regional search.
    if (
      original.route.length !== 2 ||
      original.vias.length !== 0
    ) {
      continue
    }
    const start = original.route[0]!
    const end = original.route[1]!
    const width = start.traceThickness ?? original.traceThickness
    if (
      start.z !== end.z ||
      width !== (end.traceThickness ?? original.traceThickness) ||
      resolver
        .canonicalize([traces[routeIndex]!.pcb_trace_id])
        .some((net) => protectedNets.has(net))
    ) {
      continue
    }
    const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    const region = extractRepairRegion({
      srj,
      routes: result.routes,
      bounds: {
        minX: center.x - 5,
        maxX: center.x + 5,
        minY: center.y - 5,
        maxY: center.y + 5,
      },
    })
    const localIndex = region.routeMappings.findIndex(
      (mapping) => mapping.sourceRouteIndex === routeIndex,
    )
    if (localIndex === -1) continue
    const fixed = convertRepairRoutesToTraces(
      region.routes.filter((_, index) => index !== localIndex),
      srj.layerCount,
    ).map((trace, index) => ({ ...trace, pcb_trace_id: `detour_context_${index}` }))
    const repair = negotiateTraceClearance({
      srj: { ...region.srj, traces: [...(region.srj.traces ?? []), ...fixed] },
      routes: [region.routes[localIndex]!],
      bounds: region.mutableBounds,
      dirtyRouteIndices: [0],
      isLocked: (_, pointIndex) =>
        region.lockedPointIndices[localIndex]![pointIndex]!,
      allowLayerChanges: false,
      traceClearance: Math.max(
        RELAXED_DRC_OPTIONS.traceClearance!,
        srj.minTraceToPadEdgeClearance ?? 0,
      ),
      viaClearance: RELAXED_DRC_OPTIONS.viaClearance!,
      viaHoleDiameter: holeDiameter,
      maxPathSearchCalls: maxCandidateAttempts - result.candidateAttempts,
      maxPathSearchNodes: maxPathSearchNodes - result.pathSearchNodes,
    })
    const attempts = repair.pathSearchCalls
    const nodes = repair.pathSearchNodes
    if (
      !Number.isSafeInteger(attempts) ||
      !Number.isSafeInteger(nodes) ||
      attempts < 0 ||
      nodes < 0 ||
      attempts + result.candidateAttempts > maxCandidateAttempts ||
      nodes + result.pathSearchNodes > maxPathSearchNodes
    ) {
      throw new Error("Independent wire repair exceeded its work budget")
    }
    result.candidateAttempts += attempts
    result.pathSearchNodes += nodes
    const candidate: HighDensityRoute[] = mergeRepairRegion({
      routes: result.routes,
      region,
      repairedRoutes: region.routes.map((route, index) =>
        index === localIndex ? repair.routes[0]! : route,
      ),
    })
    const changed = candidate[routeIndex]!
    const index = new SpatialObstacleIndex(
      indexInput,
      traces,
      undefined,
      [],
      resolver,
    )
    let blocked = false
    for (let pi = 1; pi < changed.route.length; pi++) {
      const a = changed.route[pi - 1]!
      const b = changed.route[pi]!
      if (
        a.z !== b.z ||
        (a.traceThickness ?? changed.traceThickness) !== width ||
        (b.traceThickness ?? changed.traceThickness) !== width ||
        index.collides({
          start: a,
          end: b,
          layer: mapZToLayerName(a.z, srj.layerCount),
          width,
          connectionNames: [traces[routeIndex]!.pcb_trace_id],
        })
      ) {
        blocked = true
        break
      }
    }
    if (blocked) continue
    const checked = drcEvaluator({
      traces: [],
      routes: candidate,
      hdRoutes: candidate,
    })
    const remaining = Array.isArray(checked) ? checked : checked.errors
    if (!canPublishIndependentClearanceRepairs(errors, remaining)) continue
    result.routes = candidate
    traces[routeIndex] = toTrace(changed, routeIndex)
    errors = remaining
  }
  return result
}
