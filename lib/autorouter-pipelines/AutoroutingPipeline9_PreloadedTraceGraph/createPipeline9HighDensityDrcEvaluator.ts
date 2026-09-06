import type { DrcEvaluator } from "high-density-repair03/lib"
import {
  createPipeline7HdRoutesToSimplifiedPcbTracesConverter,
  type ConvertPipeline7HdRoutesOptions,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import type { ChangedPreloadedTraceSection } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { assignUniquePcbTraceIdsToNewTraces } from "./assignUniquePcbTraceIdsToNewTraces"
import type { PreloadedHighDensityRoute } from "./convertPreloadedTraceToHdRoutes"
import { addAutoroutingViaTraceIds } from "./Pipeline9JointDrcRepairSolver"
import { normalizePipeline9DrcErrorsForRepair } from "./normalizePipeline9DrcErrorsForRepair"
import { preparePipeline9DrcRoutedTraces } from "./preparePipeline9DrcRoutedTraces"

type CreatePipeline9HighDensityDrcEvaluatorOptions =
  ConvertPipeline7HdRoutesOptions & {
    originalFixedHdRoutes: PreloadedHighDensityRoute[]
    fixedHdRoutes: PreloadedHighDensityRoute[]
    changedPreloadedTraceSections: ChangedPreloadedTraceSection[]
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

const addCopperOwnerMetadata = (
  errors: Record<string, unknown>[],
  traceIdByViaId: ReadonlyMap<string, string>,
): Record<string, unknown>[] => {
  return errors.map((error) => {
    const viaIds = [
      ...(typeof error.pcb_via_id === "string" ? [error.pcb_via_id] : []),
      ...(Array.isArray(error.pcb_via_ids)
        ? error.pcb_via_ids.filter(
            (viaId): viaId is string => typeof viaId === "string",
          )
        : []),
    ]
    const viaOwnerTraceIds = [
      ...new Set(
        viaIds.flatMap((viaId) => {
          const traceId = traceIdByViaId.get(viaId)
          return traceId === undefined ? [] : [traceId]
        }),
      ),
    ]
    if (viaOwnerTraceIds.length === 0) return error
    const segmentOwnerTraceId =
      (error.type === "pcb_trace_error" ||
        error.type === "pcb_via_trace_clearance_error") &&
      typeof error.pcb_trace_id === "string"
        ? error.pcb_trace_id
        : undefined
    return {
      ...error,
      __via_owner_trace_ids: viaOwnerTraceIds,
      ...(segmentOwnerTraceId === undefined
        ? {}
        : { __trace_segment_owner_trace_id: segmentOwnerTraceId }),
    }
  })
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
  const originalTraceById = new Map(
    originalTraces.map((trace) => [trace.pcb_trace_id, trace]),
  )
  const traceIdBySectionConnectionName = new Map<string, string>(
    options.changedPreloadedTraceSections.map((section) => [
      section.connectionName,
      section.traceId,
    ]),
  )
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
          (point) => point.x === originalPoint.x && point.y === originalPoint.y,
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
    const traceId = traceIdBySectionConnectionName.get(hdRoute.connectionName)
    if (traceId === undefined) {
      throw new Error(
        `Pipeline9 frozen high-density route "${hdRoute.connectionName}" has no changed preloaded section metadata`,
      )
    }
    const originalTrace = originalTraceById.get(traceId)
    if (!originalTrace) {
      throw new Error(
        `Pipeline9 frozen high-density route "${hdRoute.connectionName}" references missing preloaded trace "${traceId}"`,
      )
    }
    frozenRoutes.push({
      hdRoute: {
        ...hdRoute,
        rootConnectionName: originalTrace.connection_name,
      },
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
    const evaluatedTraceIds = new Set(
      circuitJson.flatMap((element) =>
        element.type === "pcb_trace" ? [element.pcb_trace_id] : [],
      ),
    )
    const traceIdByViaId = new Map(
      circuitJson.flatMap((element) =>
        element.type === "pcb_via" &&
        typeof element.pcb_trace_id === "string"
          ? [[element.pcb_via_id, element.pcb_trace_id] as const]
          : [],
      ),
    )
    return {
      errors: normalizePipeline9DrcErrorsForRepair({
        errors: addCopperOwnerMetadata(
          addAutoroutingViaTraceIds({
            errors: errors as unknown as Record<string, unknown>[],
            circuitJson,
            evaluatedTraceIds,
          }),
          traceIdByViaId,
        ),
        circuitJson,
        newTraceIds,
      }),
      errorsWithCenters: normalizePipeline9DrcErrorsForRepair({
        errors: addCopperOwnerMetadata(
          addAutoroutingViaTraceIds({
            errors: errorsWithCenters as unknown as Record<string, unknown>[],
            circuitJson,
            evaluatedTraceIds,
          }),
          traceIdByViaId,
        ),
        circuitJson,
        newTraceIds,
      }),
    }
  }
}
