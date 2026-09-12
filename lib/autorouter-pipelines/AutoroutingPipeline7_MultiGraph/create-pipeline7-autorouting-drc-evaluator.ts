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
    minTraceToPadEdgeClearance:
      conversionOptions.originalSrj.minTraceToPadEdgeClearance,
    minPadEdgeToPadEdgeClearance:
      conversionOptions.originalSrj.minPadEdgeToPadEdgeClearance,
    minViaHoleEdgeToViaHoleEdgeClearance:
      conversionOptions.originalSrj.minViaHoleEdgeToViaHoleEdgeClearance,
    minBoardEdgeClearance: conversionOptions.originalSrj.minBoardEdgeClearance,
    minViaHoleDiameter:
      getViaDimensions(conversionOptions.originalSrj).holeDiameter,
    allowBlindAndBuriedVias:
      conversionOptions.originalSrj.allowBlindAndBuriedVias,
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
    ) +
    Math.max(
      engineSrj.minTraceToPadEdgeClearance ?? 0.1,
      engineSrj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
      engineSrj.minPadEdgeToPadEdgeClearance ?? 0.1,
    )
  const engine = new AutoroutingDrcEngine(engineSrj as RepairSimpleRouteJson, {
    connMap: conversionOptions.connMap,
    includeTraceViaOwnerMetadata: true,
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
