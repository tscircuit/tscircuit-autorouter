import type { DrcEvaluator } from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { ConvertPipeline7HdRoutesOptions } from "../AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { normalizePipeline9DrcErrorsForRepair } from "./normalize-pipeline9-drc-errors-for-repair"
import { preparePipeline9DrcRoutedTraces } from "./prepare-pipeline9-drc-routed-traces"

type CreatePipeline9RelaxedDrcEvaluatorOptions = Omit<
  ConvertPipeline7HdRoutesOptions,
  "hdRoutes"
> & {
  srjWithPointPairs: SimpleRouteJson
  originalSrj: SimpleRouteJson
  mutatedPreloadedTraces: SimplifiedPcbTrace[]
}

/** Scores candidates using the same preloaded-trace replacement rules as output. */
export const createPipeline9RelaxedDrcEvaluator = (
  options: CreatePipeline9RelaxedDrcEvaluatorOptions,
): DrcEvaluator => {
  return ({ routes, hdRoutes }) => {
    const evaluatedRoutes = routes ?? hdRoutes
    if (!evaluatedRoutes) {
      throw new Error("Pipeline9 relaxed DRC evaluation requires HD routes")
    }

    const newTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...options,
      hdRoutes: evaluatedRoutes,
    })
    const newTraceIds = new Set(newTraces.map((trace) => trace.pcb_trace_id))
    const { errors, errorsWithCenters, circuitJson } = evaluateRelaxedDrc({
      inputSrj: options.originalSrj,
      srjWithPointPairs: options.srjWithPointPairs,
      routedTraces: preparePipeline9DrcRoutedTraces({
        originalPreloadedTraces: options.originalSrj.traces ?? [],
        mutatedPreloadedTraces: options.mutatedPreloadedTraces,
        newTraces,
      }),
    })

    return {
      errors: normalizePipeline9DrcErrorsForRepair({
        errors: errors as unknown as Record<string, unknown>[],
        circuitJson,
        newTraceIds,
      }),
      errorsWithCenters: normalizePipeline9DrcErrorsForRepair({
        errors: errorsWithCenters as unknown as Record<string, unknown>[],
        circuitJson,
        newTraceIds,
      }),
    }
  }
}
