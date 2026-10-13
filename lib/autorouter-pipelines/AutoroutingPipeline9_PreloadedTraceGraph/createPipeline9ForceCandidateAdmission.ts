import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  ForceImproveCandidate,
  ForceImproveCandidateSolutionValidator,
} from "high-density-repair01/lib/HighDensityForceImproveSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createImmutableCopperCandidateAdmission } from "./createImmutableCopperCandidateAdmission"
import { createPipeline9CopperAdmissionSerializer } from "./createPipeline9CopperAdmissionSerializer"
import {
  getPipeline9RouteCopperGeometry,
  type Pipeline9Bounds,
} from "./pipeline9FixedRouteCopper"

type AdmissionParams = {
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  physicalViaMode: boolean
  currentFixedTraces: readonly SimplifiedPcbTrace[]
  fixedOwnerByTraceId?: ReadonlyMap<string, string>
}

/** Check current copper before native Force publishes a selected family. */
export const createPipeline9ForceCandidateAdmission = ({
  srj,
  connMap,
  physicalViaMode,
  currentFixedTraces,
  fixedOwnerByTraceId = new Map(),
}: AdmissionParams): ForceImproveCandidateSolutionValidator | false => {
  if (!physicalViaMode && currentFixedTraces.length === 0) return false
  if (
    physicalViaMode &&
    (srj.layerCount !== 2 || (srj.traces?.length ?? 0) > 0)
  ) {
    throw new Error("Physical Force admission requires fresh two-layer copper")
  }
  for (const trace of currentFixedTraces) {
    const owner = fixedOwnerByTraceId.get(trace.pcb_trace_id)
    if (!owner || !connMap.netMap[owner]) {
      throw new Error("Retained Force copper lacks authoritative ownership")
    }
  }
  const serializer = createPipeline9CopperAdmissionSerializer({ srj, connMap })
  const tracesByRoute = new WeakMap<
    HighDensityRoute,
    Map<number, SimplifiedPcbTrace>
  >()
  let traceIdsByIndex: string[] | undefined
  let originalRoutesByIndex: readonly HighDensityRoute[] | undefined
  const serialize = (
    routes: readonly HighDensityRoute[],
  ): SimplifiedPcbTrace[] => {
    if (traceIdsByIndex === undefined) {
      const traces = serializer.serialize(routes)
      if (
        traces.length !== routes.length ||
        traces.some(
          (trace): boolean =>
            !serializer.generatedTraceIds.has(trace.pcb_trace_id),
        )
      ) {
        throw new Error("Force candidate lost its indexed generated copper lineage")
      }
      traceIdsByIndex = traces.map((trace): string => trace.pcb_trace_id)
      originalRoutesByIndex = [...routes]
      for (const [index, route] of routes.entries()) {
        const cached = tracesByRoute.get(route) ?? new Map()
        cached.set(index, traces[index]!)
        tracesByRoute.set(route, cached)
      }
      return traces
    }
    if (routes.length !== traceIdsByIndex.length) {
      throw new Error("Force candidate changed its current board route count")
    }
    return routes.map((route, index): SimplifiedPcbTrace => {
      const initial = originalRoutesByIndex![index]!
      if (
        route.connectionName !== initial.connectionName ||
        route.rootConnectionName !== initial.rootConnectionName ||
        route.traceThickness !== initial.traceThickness ||
        route.viaDiameter !== initial.viaDiameter
      ) {
        throw new Error("Force candidate changed its current board route lineage")
      }
      const cached = tracesByRoute.get(route)
      const existing = cached?.get(index)
      if (existing) return existing
      const traces = serializer.serialize([route])
      const trace = traces[0]
      if (
        traces.length !== 1 ||
        !trace ||
        !serializer.generatedTraceIds.has(trace.pcb_trace_id)
      ) {
        throw new Error("Force candidate lost its indexed generated copper lineage")
      }
      const traceId = traceIdsByIndex![index]!
      const owner = serializer.canonicalOwnerByTraceId.get(trace.pcb_trace_id)
      if (owner !== serializer.canonicalOwnerByTraceId.get(traceId)) {
        throw new Error("Force copper changed its authoritative owner")
      }
      const result = { ...trace, pcb_trace_id: traceId }
      const byIndex = cached ?? new Map()
      byIndex.set(index, result)
      tracesByRoute.set(route, byIndex)
      return result
    })
  }
  const boundsByRoute = new WeakMap<HighDensityRoute, Pipeline9Bounds>()
  const getBounds = (route: HighDensityRoute): Pipeline9Bounds => {
    const cached = boundsByRoute.get(route)
    if (cached) return cached
    const geometry = getPipeline9RouteCopperGeometry(route, srj)
    const bounds: Pipeline9Bounds = {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
    for (const wire of geometry.wireSegments) {
      bounds.minX = Math.min(
        bounds.minX,
        wire.start.x - wire.width / 2,
        wire.end.x - wire.width / 2,
      )
      bounds.minY = Math.min(
        bounds.minY,
        wire.start.y - wire.width / 2,
        wire.end.y - wire.width / 2,
      )
      bounds.maxX = Math.max(
        bounds.maxX,
        wire.start.x + wire.width / 2,
        wire.end.x + wire.width / 2,
      )
      bounds.maxY = Math.max(
        bounds.maxY,
        wire.start.y + wire.width / 2,
        wire.end.y + wire.width / 2,
      )
    }
    for (const via of geometry.viaSpans) {
      bounds.minX = Math.min(bounds.minX, via.center.x - via.diameter / 2)
      bounds.minY = Math.min(bounds.minY, via.center.y - via.diameter / 2)
      bounds.maxX = Math.max(bounds.maxX, via.center.x + via.diameter / 2)
      bounds.maxY = Math.max(bounds.maxY, via.center.y + via.diameter / 2)
    }
    boundsByRoute.set(route, bounds)
    return bounds
  }
  const maximumClearance = Math.max(
    srj.minTraceToPadEdgeClearance ?? 0.1,
    srj.minPadEdgeToPadEdgeClearance ?? 0.1,
    srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
    srj.minTraceToHoleEdgeClearance ?? srj.minTraceToPadEdgeClearance ?? 0.1,
    srj.minViaEdgeToPadEdgeClearance ?? srj.minPadEdgeToPadEdgeClearance ?? 0.1,
  )
  const freshRules: SimpleRouteJson = {
    ...srj,
    minTraceToPadEdgeClearance: 0,
    minPadEdgeToPadEdgeClearance: 0,
    // Zero applies only to fresh trace copper. Drills and NPTH keep the
    // actual declared rules, including their existing omitted-field defaults.
    minTraceToHoleEdgeClearance:
      srj.minTraceToHoleEdgeClearance ?? srj.minTraceToPadEdgeClearance ?? 0.1,
    minViaEdgeToPadEdgeClearance:
      srj.minViaEdgeToPadEdgeClearance ?? srj.minPadEdgeToPadEdgeClearance ?? 0.1,
  }
  const freshObstacles = srj.obstacles.filter(
    (obstacle): boolean => obstacle.isNonPlatedHole === true,
  )
  return (candidate: ForceImproveCandidate): boolean => {
    const { routeIndexes, originalRoutes, candidateRoutes, currentHdRoutes } =
      candidate
    if (
      routeIndexes.length !== originalRoutes.length ||
      routeIndexes.length !== candidateRoutes.length ||
      new Set(routeIndexes).size !== routeIndexes.length
    ) {
      throw new Error("Force candidate routes must preserve their index lineage")
    }
    const proposed = [...currentHdRoutes]
    for (const [index, routeIndex] of routeIndexes.entries()) {
      const original = originalRoutes[index]!
      const next = candidateRoutes[index]!
      if (
        !Number.isInteger(routeIndex) ||
        routeIndex < 0 ||
        routeIndex >= currentHdRoutes.length ||
        original !== currentHdRoutes[routeIndex] ||
        original.connectionName !== next.connectionName ||
        original.rootConnectionName !== next.rootConnectionName ||
        original.traceThickness !== next.traceThickness ||
        original.viaDiameter !== next.viaDiameter
      ) {
        throw new Error("Force candidate lost its original ownership or widths")
      }
      proposed[routeIndex] = next
    }
    const initialTraces = serialize(currentHdRoutes)
    const proposedTraces = serialize(proposed)
    if (
      initialTraces.length !== currentHdRoutes.length ||
      proposedTraces.length !== currentHdRoutes.length ||
      initialTraces.some(
        (trace, index): boolean =>
          !serializer.generatedTraceIds.has(trace.pcb_trace_id) ||
          trace.pcb_trace_id !== proposedTraces[index]!.pcb_trace_id,
      )
    ) {
      throw new Error("Force candidate lost its indexed generated copper lineage")
    }
    const selected = new Set(routeIndexes)
    const canonicalOwnerByTraceId = new Map(fixedOwnerByTraceId)
    for (const [traceId, owner] of serializer.canonicalOwnerByTraceId) {
      const existingOwner = canonicalOwnerByTraceId.get(traceId)
      if (existingOwner !== undefined && existingOwner !== owner) {
        throw new Error("Force copper changed its authoritative owner")
      }
      canonicalOwnerByTraceId.set(traceId, owner)
    }
    const initialMovableTraces = routeIndexes.map(
      (index): SimplifiedPcbTrace => initialTraces[index]!,
    )
    const candidateTraces = routeIndexes.map(
      (index): SimplifiedPcbTrace => proposedTraces[index]!,
    )
    const affectedBounds: Pipeline9Bounds = {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
    for (const route of [...originalRoutes, ...candidateRoutes]) {
      const bounds = getBounds(route)
      affectedBounds.minX = Math.min(affectedBounds.minX, bounds.minX)
      affectedBounds.minY = Math.min(affectedBounds.minY, bounds.minY)
      affectedBounds.maxX = Math.max(affectedBounds.maxX, bounds.maxX)
      affectedBounds.maxY = Math.max(affectedBounds.maxY, bounds.maxY)
    }
    // Bounds include the larger adjacent width and every full via barrel.
    // The union of both families plus all rules conservatively includes every
    // peer that can constrain either the baseline or the selected proposal.
    const peerTraces = initialTraces.filter((_, index): boolean => {
      if (selected.has(index)) return false
      const bounds = getBounds(currentHdRoutes[index]!)
      return (
        bounds.minX <= affectedBounds.maxX + maximumClearance &&
        bounds.maxX >= affectedBounds.minX - maximumClearance &&
        bounds.minY <= affectedBounds.maxY + maximumClearance &&
        bounds.maxY >= affectedBounds.minY - maximumClearance
      )
    })
    const admit = (
      rules: SimpleRouteJson,
      fixed: readonly SimplifiedPcbTrace[],
      obstacles: SimpleRouteJson["obstacles"],
    ): boolean => {
      const check = createImmutableCopperCandidateAdmission({
        srj: rules,
        connMap,
        immutableTraces: fixed,
        initialMovableTraces,
        peerTraces,
        includeMovableCopper: true,
        boardObstacles: obstacles,
        canonicalOwnerByTraceId,
      })
      return check(candidateTraces)
    }
    if (physicalViaMode && !admit(freshRules, [], freshObstacles)) return false
    return (
      currentFixedTraces.length === 0 ||
      admit(srj, currentFixedTraces, srj.obstacles)
    )
  }
}
