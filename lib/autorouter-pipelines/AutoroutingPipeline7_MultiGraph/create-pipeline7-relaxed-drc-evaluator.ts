import type { DrcEvaluator } from "high-density-repair03/lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import {
  convertPipeline7HdRoutesToSimplifiedPcbTraces,
  type ConvertPipeline7HdRoutesOptions,
} from "./convertPipeline7HdRoutesToSimplifiedPcbTraces"

/** Scores Pipeline7 repair candidates with the benchmark relaxed DRC. */
export const createPipeline7RelaxedDrcEvaluator = (
  conversionOptions: Omit<ConvertPipeline7HdRoutesOptions, "hdRoutes"> & {
    srjWithPointPairs: SimpleRouteJson
    originalSrj: SimpleRouteJson
  },
): DrcEvaluator => {
  return ({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes
    if (!evaluatedRoutes) {
      throw new Error("Pipeline7 relaxed DRC evaluation requires HD routes")
    }

    const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...conversionOptions,
      hdRoutes: evaluatedRoutes,
    })
    const { errors, errorsWithCenters } = evaluateRelaxedDrc({
      inputSrj: conversionOptions.originalSrj,
      srjWithPointPairs: conversionOptions.srjWithPointPairs,
      traces,
    })

    const centeredErrors =
      errorsWithCenters.length === errors.length ? errorsWithCenters : errors

    return {
      // high-density-repair03 currently consumes `errors` from its custom
      // evaluator snapshot. Put the center-enriched form there as well so
      // via-only errors can participate in localized repair.
      errors: centeredErrors as unknown as Record<string, unknown>[],
      errorsWithCenters: centeredErrors as unknown as Record<string, unknown>[],
    }
  }
}
