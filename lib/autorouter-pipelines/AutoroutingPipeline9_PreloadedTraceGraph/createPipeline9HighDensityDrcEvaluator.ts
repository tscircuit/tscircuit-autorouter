import type { DrcEvaluator } from "high-density-repair03/lib"
import {
  createPipeline7HdRoutesToSimplifiedPcbTracesConverter,
  type ConvertPipeline7HdRoutesOptions,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { assignUniquePcbTraceIdsToNewTraces } from "./assignUniquePcbTraceIdsToNewTraces"
import type { PreloadedHighDensityRoute } from "./convertPreloadedTraceToHdRoutes"
import { normalizePipeline9DrcErrorsForRepair } from "./normalizePipeline9DrcErrorsForRepair"
import { preparePipeline9DrcRoutedTraces } from "./preparePipeline9DrcRoutedTraces"

type CreatePipeline9HighDensityDrcEvaluatorOptions =
  ConvertPipeline7HdRoutesOptions & {
    originalFixedHdRoutes: PreloadedHighDensityRoute[]
    fixedHdRoutes: PreloadedHighDensityRoute[]
    originalSrj: SimpleRouteJson
    srjWithPointPairs: SimpleRouteJson
  }

type FrozenHighDensityTrace = {
  hdRoute: HighDensityRoute
  originalTrace: SimplifiedPcbTrace
  viaHoleDiameter: number
}

type HighDensityDrcResult = {
  errors: Record<string, unknown>[]
  errorsWithCenters: Record<string, unknown>[]
}

const hasSameFixedCopper = (
  original: PreloadedHighDensityRoute,
  current: PreloadedHighDensityRoute,
): boolean => {
  if (
    original.traceThickness !== current.traceThickness ||
    original.viaDiameter !== current.viaDiameter ||
    original.preloadedTraceIndex !== current.preloadedTraceIndex ||
    original.preloadedRoutePositionStart !==
      current.preloadedRoutePositionStart ||
    original.preloadedRoutePositionEnd !== current.preloadedRoutePositionEnd ||
    original.route.length !== current.route.length ||
    original.vias.length !== current.vias.length ||
    original.vias.some(
      (via, index) =>
        via.x !== current.vias[index]!.x || via.y !== current.vias[index]!.y,
    )
  ) {
    return false
  }
  return original.route.every((point, index) => {
    const currentPoint = current.route[index]!
    return (
      point.x === currentPoint.x &&
      point.y === currentPoint.y &&
      point.z === currentPoint.z &&
      point.traceThickness === currentPoint.traceThickness &&
      point.toNextSegmentType === currentPoint.toNextSegmentType
    )
  })
}

/** Checks current pre-stitch copper without restoring removed preload sections. */
export const createPipeline9HighDensityDrcEvaluator = (
  options: CreatePipeline9HighDensityDrcEvaluatorOptions,
): DrcEvaluator => {
  const originalTraces = options.originalSrj.traces ?? []
  const ownedConnectionNames = new Set(
    options.connections.map((connection) => connection.name),
  )
  const currentRouteByConnectionName = new Map(
    options.fixedHdRoutes.map((route) => [route.connectionName, route]),
  )
  const originalRouteCounts = new Map<number, number>()
  const currentRouteCounts = new Map<number, number>()
  const unchangedRouteCounts = new Map<number, number>()
  for (const route of options.fixedHdRoutes) {
    currentRouteCounts.set(
      route.preloadedTraceIndex,
      (currentRouteCounts.get(route.preloadedTraceIndex) ?? 0) + 1,
    )
  }
  for (const originalRoute of options.originalFixedHdRoutes) {
    const traceIndex = originalRoute.preloadedTraceIndex
    originalRouteCounts.set(
      traceIndex,
      (originalRouteCounts.get(traceIndex) ?? 0) + 1,
    )
    const currentRoute = currentRouteByConnectionName.get(
      originalRoute.connectionName,
    )
    if (currentRoute && hasSameFixedCopper(originalRoute, currentRoute)) {
      unchangedRouteCounts.set(
        traceIndex,
        (unchangedRouteCounts.get(traceIndex) ?? 0) + 1,
      )
    }
  }
  const unchangedTraceIndices = new Set(
    originalTraces.flatMap((_, traceIndex) => {
      const originalCount = originalRouteCounts.get(traceIndex) ?? 0
      return originalCount === (currentRouteCounts.get(traceIndex) ?? 0) &&
        originalCount === (unchangedRouteCounts.get(traceIndex) ?? 0)
        ? [traceIndex]
        : []
    }),
  )
  const frozenRoutes: FrozenHighDensityTrace[] = options.fixedHdRoutes
    .filter((route) => !unchangedTraceIndices.has(route.preloadedTraceIndex))
    .map((hdRoute): FrozenHighDensityTrace => {
      const originalTrace = originalTraces[hdRoute.preloadedTraceIndex]
      if (!originalTrace) {
        throw new Error(
          `Pipeline9 fixed route "${hdRoute.connectionName}" has no original preloaded trace`,
        )
      }
      const originalPoint =
        hdRoute.preloadedRoutePositionStart === undefined
          ? undefined
          : originalTrace.route[hdRoute.preloadedRoutePositionStart]
      const originalViaHoleDiameter =
        originalPoint?.route_type === "via" &&
        hdRoute.route.every(
          (point) =>
            point.x === originalPoint.x && point.y === originalPoint.y,
        )
          ? originalPoint.via_hole_diameter
          : undefined
      return {
        hdRoute,
        originalTrace,
        viaHoleDiameter:
          originalViaHoleDiameter ?? options.defaultViaHoleDiameter,
      }
    })
  for (const hdRoute of options.hdRoutes) {
    if (ownedConnectionNames.has(hdRoute.connectionName)) continue
    const originalTrace = originalTraces.find(
      (trace) =>
        trace.connection_name === hdRoute.rootConnectionName ||
        options.connMap.areIdsConnected(
          trace.connection_name,
          hdRoute.rootConnectionName ?? hdRoute.connectionName,
        ),
    )
    if (!originalTrace) {
      throw new Error(
        `Pipeline9 frozen high-density route "${hdRoute.connectionName}" has no original preloaded net`,
      )
    }
    frozenRoutes.push({
      hdRoute,
      originalTrace,
      viaHoleDiameter: options.defaultViaHoleDiameter,
    })
  }
  const unchangedTraces = originalTraces.filter((_, traceIndex) =>
    unchangedTraceIndices.has(traceIndex),
  )
  const frozenFragments = frozenRoutes.map(
    (
      { hdRoute, originalTrace, viaHoleDiameter },
      index,
    ): SimplifiedPcbTrace => ({
      type: "pcb_trace",
      pcb_trace_id: `${originalTrace.pcb_trace_id}_high_density_fixed_${index}`,
      connection_name: originalTrace.connection_name,
      connectsTo: originalTrace.connectsTo,
      route: convertHdRouteToSimplifiedRoute(hdRoute, options.layerCount, {
        defaultViaHoleDiameter: viaHoleDiameter,
        obstacles: options.obstacles,
        connMap: options.connMap,
      }),
    }),
  )
  const frozenTraces = [
    ...unchangedTraces,
    ...assignUniquePcbTraceIdsToNewTraces(frozenFragments, unchangedTraces),
  ]
  const inputSrj = { ...options.originalSrj, traces: frozenTraces }
  const convertNewRoutes =
    createPipeline7HdRoutesToSimplifiedPcbTracesConverter(options)

  return ({ routes, hdRoutes }): HighDensityDrcResult => {
    const evaluatedRoutes = routes ?? hdRoutes
    if (!evaluatedRoutes) {
      throw new Error("Pipeline9 high-density DRC evaluation requires routes")
    }
    const newTraces = convertNewRoutes(evaluatedRoutes)
    const newTraceIds = new Set(newTraces.map((trace) => trace.pcb_trace_id))
    const { errors, errorsWithCenters, circuitJson } = evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs: options.srjWithPointPairs,
      routedTraces: preparePipeline9DrcRoutedTraces({
        originalPreloadedTraces: frozenTraces,
        mutatedPreloadedTraces: [],
        newTraces,
      }),
      drcOptions: {
        includeTraceContinuity: false,
        includeBoardEdge: false,
      },
    })
    return {
      errors: normalizePipeline9DrcErrorsForRepair({
        errors: errors as unknown as Record<string, unknown>[],
        circuitJson,
        newTraceIds,
      }),
      errorsWithCenters: normalizePipeline9DrcErrorsForRepair({
        errors: errorsWithCenters as unknown as Record<string, unknown>[],
        circuitJson,
        newTraceIds,
      }),
    }
  }
}
