import type { DrcEvaluator } from "high-density-repair03/lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import {
  convertHdRoutesToSimplifiedPcbTraces,
  type ConvertHdRoutesOptions,
} from "lib/utils/convertHdRoutesToSimplifiedPcbTraces"

/** Scores Pipeline7 repair candidates with the benchmark relaxed DRC. */
export const createPipeline7RelaxedDrcEvaluator = (
  conversionOptions: Omit<ConvertHdRoutesOptions, "hdRoutes"> & {
    srjWithPointPairs: SimpleRouteJson
    originalSrj: SimpleRouteJson
  },
): DrcEvaluator => {
  return ({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes
    if (!evaluatedRoutes) {
      throw new Error("Pipeline7 relaxed DRC evaluation requires HD routes")
    }

    const traces = convertHdRoutesToSimplifiedPcbTraces({
      ...conversionOptions,
      hdRoutes: evaluatedRoutes,
    })
    const { errors, errorsWithCenters } = evaluateRelaxedDrc({
      inputSrj: conversionOptions.originalSrj,
      srjWithPointPairs: conversionOptions.srjWithPointPairs,
      routedTraces: traces,
    })

    return {
      errors: errors as unknown as Record<string, unknown>[],
      errorsWithCenters: errorsWithCenters as unknown as Record<
        string,
        unknown
      >[],
    }
  }
}
