import type { DrcEvaluator } from "high-density-repair03/lib"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import {
  convertPipeline7HdRoutesToSimplifiedPcbTraces,
  type ConvertPipeline7HdRoutesOptions,
} from "./convertPipeline7HdRoutesToSimplifiedPcbTraces"

/** Scores candidates with the same conversion and DRC options as benchmark-run-task. */
export const createPipeline7BenchmarkDrcEvaluator = (
  conversionOptions: Omit<ConvertPipeline7HdRoutesOptions, "hdRoutes"> & {
    srjWithPointPairs: Parameters<typeof convertToCircuitJson>[0]
    originalSrj: Parameters<typeof convertToCircuitJson>[0]
  },
): DrcEvaluator => {
  return ({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes
    if (!evaluatedRoutes) {
      throw new Error("Benchmark DRC evaluation requires HD routes")
    }

    const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...conversionOptions,
      hdRoutes: evaluatedRoutes,
    })
    const circuitJson = convertToCircuitJson(
      conversionOptions.srjWithPointPairs,
      traces,
      {
        minTraceWidth: conversionOptions.originalSrj.minTraceWidth,
        minViaDiameter: conversionOptions.originalSrj.minViaDiameter,
      },
    )
    const { errors, errorsWithCenters } = getDrcErrors(
      circuitJson,
      RELAXED_DRC_OPTIONS,
    )

    return {
      errors: errors as unknown as Record<string, unknown>[],
      errorsWithCenters: errorsWithCenters as unknown as Record<
        string,
        unknown
      >[],
    }
  }
}
