import type { DrcEvaluator } from "high-density-repair03/lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import {
  convertPipeline7HdRoutesToSimplifiedPcbTraces,
  type ConvertPipeline7HdRoutesOptions,
} from "./convertPipeline7HdRoutesToSimplifiedPcbTraces"

type RelaxedDrcCacheEntry = {
  routeFingerprint: string
  result: ReturnType<DrcEvaluator>
}

/** Scores Pipeline7 repair candidates with the benchmark relaxed DRC. */
export const createPipeline7RelaxedDrcEvaluator = (
  conversionOptions: Omit<ConvertPipeline7HdRoutesOptions, "hdRoutes"> & {
    srjWithPointPairs: SimpleRouteJson
    originalSrj: SimpleRouteJson
  },
): DrcEvaluator => {
  const relaxedDrcResultCache = new WeakMap<object, RelaxedDrcCacheEntry>()
  const evaluator = (({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes
    if (!evaluatedRoutes) {
      throw new Error("Pipeline7 relaxed DRC evaluation requires HD routes")
    }
    const routeFingerprint = JSON.stringify(evaluatedRoutes)
    const cachedEntry = relaxedDrcResultCache.get(evaluatedRoutes)
    if (cachedEntry?.routeFingerprint === routeFingerprint) {
      return cachedEntry.result
    }

    const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...conversionOptions,
      hdRoutes: evaluatedRoutes,
    })
    const { errors, errorsWithCenters } = evaluateRelaxedDrc({
      inputSrj: conversionOptions.originalSrj,
      srjWithPointPairs: conversionOptions.srjWithPointPairs,
      routedTraces: traces,
    })

    const result = {
      errors: errors as unknown as Record<string, unknown>[],
      errorsWithCenters: errorsWithCenters as unknown as Record<
        string,
        unknown
      >[],
    }
    relaxedDrcResultCache.set(evaluatedRoutes, { routeFingerprint, result })
    return result
  }) as DrcEvaluator
  evaluator.getCachedResult = ({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes
    if (!evaluatedRoutes) return undefined
    const cachedEntry = relaxedDrcResultCache.get(evaluatedRoutes)
    if (
      !cachedEntry ||
      cachedEntry.routeFingerprint !== JSON.stringify(evaluatedRoutes)
    ) {
      return undefined
    }
    return cachedEntry.result
  }
  return evaluator
}
