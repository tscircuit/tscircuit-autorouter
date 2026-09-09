import { addAutoroutingViaTraceIds } from "lib/utils/addAutoroutingViaTraceIds"
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
    const { errors, errorsWithCenters, circuitJson } = evaluateRelaxedDrc({
      inputSrj: conversionOptions.originalSrj,
      srjWithPointPairs: conversionOptions.srjWithPointPairs,
      routedTraces: traces,
    })

    const evaluatedTraceIds = new Set(traces.map((trace) => trace.pcb_trace_id))
    return {
      errors: addAutoroutingViaTraceIds({
        errors: errors as unknown as Record<string, unknown>[],
        circuitJson,
        evaluatedTraceIds,
      }),
      errorsWithCenters: addAutoroutingViaTraceIds({
        errors: errorsWithCenters as unknown as Record<string, unknown>[],
        circuitJson,
        evaluatedTraceIds,
      }),
    }
  }
}
