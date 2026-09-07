import {
  AutoroutingDrcEngine,
  type DrcEvaluator,
  type SimpleRouteJson as RepairSimpleRouteJson,
  type SimplifiedPcbTraces as RepairSimplifiedPcbTraces,
} from "high-density-repair03/lib"
import type { SimpleRouteJson } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import {
  type ConvertPipeline7HdRoutesOptions,
  createPipeline7HdRoutesToSimplifiedPcbTracesConverter,
} from "./convertPipeline7HdRoutesToSimplifiedPcbTraces"

const DEFAULT_AUTOROUTING_TRACE_CLEARANCE = 0.1
const DEFAULT_AUTOROUTING_VIA_CLEARANCE = 0.1

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
    minViaHoleDiameter:
      conversionOptions.originalSrj.minViaHoleDiameter ??
      conversionOptions.srjWithPointPairs.minViaHoleDiameter,
    minTraceToPadEdgeClearance:
      conversionOptions.originalSrj.minTraceToPadEdgeClearance ??
      conversionOptions.srjWithPointPairs.minTraceToPadEdgeClearance,
    minViaEdgeToPadEdgeClearance:
      conversionOptions.originalSrj.minViaEdgeToPadEdgeClearance ??
      conversionOptions.srjWithPointPairs.minViaEdgeToPadEdgeClearance,
    minViaHoleEdgeToViaHoleEdgeClearance:
      conversionOptions.originalSrj.minViaHoleEdgeToViaHoleEdgeClearance ??
      conversionOptions.srjWithPointPairs.minViaHoleEdgeToViaHoleEdgeClearance,
  }
  const viaDimensions = getViaDimensions(conversionOptions.originalSrj)
  const traceClearance =
    engineSrj.minTraceToPadEdgeClearance ?? DEFAULT_AUTOROUTING_TRACE_CLEARANCE
  const viaClearance =
    engineSrj.minViaHoleEdgeToViaHoleEdgeClearance ??
    DEFAULT_AUTOROUTING_VIA_CLEARANCE
  // DRC interactions cannot span farther than the widest copper feature plus
  // clearance. Indexing at that physical scale avoids board-size-dependent
  // cells that become increasingly coarse on large layouts.
  const spatialCellSize =
    Math.max(viaDimensions.padDiameter, engineSrj.minTraceWidth) +
    Math.max(traceClearance, viaClearance)
  const engine = new AutoroutingDrcEngine(engineSrj as RepairSimpleRouteJson, {
    connMap: conversionOptions.connMap,
    includeTraceViaOwnerMetadata: true,
    traceClearance,
    viaClearance,
    viaToPadClearance: engineSrj.minViaEdgeToPadEdgeClearance,
    viaHoleDiameter: viaDimensions.holeDiameter,
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
