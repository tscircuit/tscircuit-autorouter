import {
  AutoroutingDrcEngine,
  type DrcEvaluator,
  type SimplifiedPcbTraces as RepairSimplifiedPcbTraces,
  type SimpleRouteJson as RepairSimpleRouteJson,
} from "high-density-repair03/lib"
import type { SimpleRouteJson } from "lib/types"
import {
  convertPipeline7HdRoutesToSimplifiedPcbTraces,
  type ConvertPipeline7HdRoutesOptions,
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
  const engine = new AutoroutingDrcEngine(engineSrj as RepairSimpleRouteJson, {
    connMap: conversionOptions.connMap,
    traceClearance: AUTOROUTING_TRACE_CLEARANCE,
    viaClearance: AUTOROUTING_VIA_CLEARANCE,
  })

  return ({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes
    if (!evaluatedRoutes) {
      throw new Error("Pipeline7 autorouting DRC evaluation requires HD routes")
    }

    const candidateTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...conversionOptions,
      hdRoutes: evaluatedRoutes,
    })
    const tracesToEvaluate = [
      ...(conversionOptions.originalSrj.traces ?? []),
      ...candidateTraces,
    ] as RepairSimplifiedPcbTraces

    return engine.evaluate(tracesToEvaluate)
  }
}
