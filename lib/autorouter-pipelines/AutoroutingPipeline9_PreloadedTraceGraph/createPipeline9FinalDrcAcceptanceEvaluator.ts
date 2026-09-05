import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "../AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import type { ConvertPipeline7HdRoutesOptions } from "../AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { assignUniquePcbTraceIdsToNewTraces } from "./assignUniquePcbTraceIdsToNewTraces"
import type { Pipeline9JointDrcOutput } from "./Pipeline9JointDrcRepairSolver"
import { preparePipeline9DrcRoutedTraces } from "./preparePipeline9DrcRoutedTraces"

/** Uses final-output conversion, preload replacement and unchanged DRC defaults. */
export const createPipeline9FinalDrcAcceptanceEvaluator = (
  options: Omit<
    ConvertPipeline7HdRoutesOptions,
    "hdRoutes" | "originalConnections"
  > & {
    originalSrj: SimpleRouteJson
    srjWithPointPairs: SimpleRouteJson
  },
): ((output: Pipeline9JointDrcOutput) => number) => {
  const convert = createPipeline7HdRoutesToSimplifiedPcbTracesConverter({
    ...options,
    originalConnections: options.originalSrj.connections,
  })
  return ({ newHdRoutes, mutatedPreloadedTraces }) => {
    const newTraces = assignUniquePcbTraceIdsToNewTraces(
      convert(newHdRoutes),
      options.originalSrj.traces ?? [],
    )
    return evaluateRelaxedDrc({
      inputSrj: options.originalSrj,
      srjWithPointPairs: options.srjWithPointPairs,
      routedTraces: preparePipeline9DrcRoutedTraces({
        originalPreloadedTraces: options.originalSrj.traces ?? [],
        mutatedPreloadedTraces,
        newTraces,
      }),
    }).errors.length
  }
}
