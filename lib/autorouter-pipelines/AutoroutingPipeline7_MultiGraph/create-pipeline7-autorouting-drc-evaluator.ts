import {
  AutoroutingDrcEngine,
  type DrcEvaluator,
  type SimpleRouteJson as RepairSimpleRouteJson,
  type SimplifiedPcbTraces as RepairSimplifiedPcbTraces,
} from "high-density-repair03/lib"
import stableStringify from "fast-json-stable-stringify"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import {
  type ConvertPipeline7HdRoutesOptions,
  createPipeline7HdRoutesToSimplifiedPcbTracesConverter,
} from "./convertPipeline7HdRoutesToSimplifiedPcbTraces"

const AUTOROUTING_TRACE_CLEARANCE = 0.1
const AUTOROUTING_VIA_CLEARANCE = 0.1

/**
 * Scores Pipeline7 repair candidates with reusable autorouting-only DRC state.
 *
 * The checks-based relaxed evaluator remains the reference implementation used
 * by tests and benchmarks; it is intentionally not used in this hot path.
 */
export const createPipeline7AutoroutingDrcEvaluator = (
  conversionOptions: Omit<ConvertPipeline7HdRoutesOptions, "hdRoutes"> & {
    srjWithPointPairs: SimpleRouteJson
    originalSrj: SimpleRouteJson
  },
): DrcEvaluator => {
  const engineSrj = {
    ...conversionOptions.srjWithPointPairs,
    minTraceWidth: conversionOptions.originalSrj.minTraceWidth,
    minViaDiameter:
      conversionOptions.originalSrj.minViaDiameter ??
      conversionOptions.srjWithPointPairs.minViaDiameter,
  }
  // DRC interactions cannot span farther than the widest copper feature plus
  // clearance. Indexing at that physical scale avoids board-size-dependent
  // cells that become increasingly coarse on large layouts.
  const spatialCellSize =
    Math.max(
      getViaDimensions(conversionOptions.originalSrj).padDiameter,
      engineSrj.minTraceWidth,
    ) + Math.max(AUTOROUTING_TRACE_CLEARANCE, AUTOROUTING_VIA_CLEARANCE)
  const engine = new AutoroutingDrcEngine(engineSrj as RepairSimpleRouteJson, {
    connMap: conversionOptions.connMap,
    traceClearance: AUTOROUTING_TRACE_CLEARANCE,
    viaClearance: AUTOROUTING_VIA_CLEARANCE,
    spatialCellSize,
  })
  const convertCandidateRoutes =
    createPipeline7HdRoutesToSimplifiedPcbTracesConverter(conversionOptions)
  const originalTraces = conversionOptions.originalSrj.traces ?? []
  const routeGeometryIdByKey = new Map<string, number>()
  const resultByBoardGeometryKey = new Map<string, ReturnType<DrcEvaluator>>()
  let nextRouteGeometryId = 0

  const getRouteGeometryId = (route: HighDensityRoute): number => {
    const routeGeometryKey = stableStringify(route)
    const existingId = routeGeometryIdByKey.get(routeGeometryKey)
    if (existingId !== undefined) return existingId
    const routeGeometryId = nextRouteGeometryId
    nextRouteGeometryId += 1
    routeGeometryIdByKey.set(routeGeometryKey, routeGeometryId)
    return routeGeometryId
  }

  const getBoardGeometryKey = (routes: HighDensityRoute[]): string => {
    const routeGeometryIds: number[] = []
    for (const route of routes) {
      routeGeometryIds.push(getRouteGeometryId(route))
    }
    return routeGeometryIds.join(",")
  }

  const evaluator: DrcEvaluator = ({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes
    if (!evaluatedRoutes) {
      throw new Error("Pipeline7 autorouting DRC evaluation requires HD routes")
    }
    const boardGeometryKey = getBoardGeometryKey(evaluatedRoutes)
    const cachedResult = resultByBoardGeometryKey.get(boardGeometryKey)
    if (cachedResult !== undefined) return cachedResult

    const candidateTraces = convertCandidateRoutes(evaluatedRoutes)
    const tracesToEvaluate = (
      originalTraces.length
        ? [...originalTraces, ...candidateTraces]
        : candidateTraces
    ) as RepairSimplifiedPcbTraces

    const result = engine.evaluate(tracesToEvaluate)
    resultByBoardGeometryKey.set(boardGeometryKey, result)
    return result
  }
  evaluator.consumesHdRoutesDirectly = true
  return evaluator
}
