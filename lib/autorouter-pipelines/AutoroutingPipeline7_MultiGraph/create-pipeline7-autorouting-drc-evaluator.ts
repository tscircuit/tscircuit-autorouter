import {
  AutoroutingDrcEngine,
  type DrcEvaluator,
  type SimpleRouteJson as RepairSimpleRouteJson,
  type SimplifiedPcbTraces as RepairSimplifiedPcbTraces,
} from "high-density-repair03/lib"
import type { SimpleRouteJson } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
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
    // Preserve physical pad geometry rather than routing approximations.
    obstacles: conversionOptions.originalSrj.obstacles,
    minTraceWidth: conversionOptions.originalSrj.minTraceWidth,
    minViaDiameter:
      conversionOptions.originalSrj.minViaDiameter ??
      conversionOptions.srjWithPointPairs.minViaDiameter,
  }
  const viaToPadClearance = getViaToPadClearance(conversionOptions.originalSrj)
  // Size spatial cells near the widest copper feature and trace/via gaps,
  // avoiding board-size-dependent cells that grow coarse on large layouts.
  // The engine expands indexed obstacles by the configured pad clearance.
  const spatialCellSize =
    Math.max(
      getViaDimensions(conversionOptions.originalSrj).padDiameter,
      engineSrj.minTraceWidth,
    ) + Math.max(AUTOROUTING_TRACE_CLEARANCE, AUTOROUTING_VIA_CLEARANCE)
  const engine = new AutoroutingDrcEngine(engineSrj as RepairSimpleRouteJson, {
    connMap: conversionOptions.connMap,
    includeTraceViaOwnerMetadata: true,
    traceClearance: AUTOROUTING_TRACE_CLEARANCE,
    viaClearance: AUTOROUTING_VIA_CLEARANCE,
    viaToPadClearance,
    spatialCellSize,
  })
  const convertCandidateRoutes =
    createPipeline7HdRoutesToSimplifiedPcbTracesConverter(conversionOptions)
  const originalTraces = conversionOptions.originalSrj.traces ?? []

  return ({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes
    if (!evaluatedRoutes) {
      throw new Error("Pipeline7 autorouting DRC evaluation requires HD routes")
    }

    const candidateTraces = convertCandidateRoutes(evaluatedRoutes)
    const tracesToEvaluate = (
      originalTraces.length
        ? [...originalTraces, ...candidateTraces]
        : candidateTraces
    ) as RepairSimplifiedPcbTraces

    return engine.evaluate(tracesToEvaluate)
  }
}
