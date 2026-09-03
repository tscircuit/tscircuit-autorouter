import type { SimplifiedPcbTrace } from "lib/types"
import { assignUniquePcbTraceIdsToNewTraces } from "./assignUniquePcbTraceIdsToNewTraces"

type MovablePreloadedSectionIdentity = {
  originalTrace: SimplifiedPcbTrace
  syntheticConnectionName: string
  evaluationTraceId: string
}

export type Pipeline9JointDrcCandidateIdentityPlan = {
  movableTraceIds: ReadonlySet<string>
  originalTraceIdByEvaluationTraceId: ReadonlyMap<string, string>
  solverTraceIdByEvaluationTraceId: ReadonlyMap<string, string>
  solverTraceIds: readonly string[]
}

/**
 * Trace ownership and collision-safe IDs depend on candidate topology, not
 * copper coordinates. Cache that plan while repair strategies move geometry.
 */
export const createPipeline9JointDrcCandidateIdentityPlanner = ({
  originalPreloadedTraces,
  movablePreloadedSections,
}: {
  originalPreloadedTraces: readonly SimplifiedPcbTrace[]
  movablePreloadedSections: readonly MovablePreloadedSectionIdentity[]
}): ((
  evaluatedNewTraces: readonly SimplifiedPcbTrace[],
) => Pipeline9JointDrcCandidateIdentityPlan) => {
  const originalTraceIdByEvaluationTraceId = new Map(
    movablePreloadedSections.map((section) => [
      section.evaluationTraceId,
      section.originalTrace.pcb_trace_id,
    ]),
  )
  let cachedEvaluationTraceIds: readonly string[] | undefined
  let cachedPlan: Pipeline9JointDrcCandidateIdentityPlan | undefined

  return (
    evaluatedNewTraces: readonly SimplifiedPcbTrace[],
  ): Pipeline9JointDrcCandidateIdentityPlan => {
    const topologyMatches =
      cachedEvaluationTraceIds?.length === evaluatedNewTraces.length &&
      evaluatedNewTraces.every(
        (trace, traceIndex) =>
          trace.pcb_trace_id === cachedEvaluationTraceIds?.[traceIndex],
      )
    if (topologyMatches) return cachedPlan!

    const uniquelyNamedNewTraces = assignUniquePcbTraceIdsToNewTraces(
      [...evaluatedNewTraces],
      originalPreloadedTraces,
    )
    const solverTraceIdByEvaluationTraceId = new Map<string, string>()
    for (
      let traceIndex = 0;
      traceIndex < evaluatedNewTraces.length;
      traceIndex++
    ) {
      solverTraceIdByEvaluationTraceId.set(
        uniquelyNamedNewTraces[traceIndex]!.pcb_trace_id,
        evaluatedNewTraces[traceIndex]!.pcb_trace_id,
      )
    }
    for (const movableSection of movablePreloadedSections) {
      solverTraceIdByEvaluationTraceId.set(
        movableSection.evaluationTraceId,
        `${movableSection.syntheticConnectionName}_0`,
      )
    }
    cachedEvaluationTraceIds = evaluatedNewTraces.map(
      (trace) => trace.pcb_trace_id,
    )
    cachedPlan = {
      movableTraceIds: new Set(solverTraceIdByEvaluationTraceId.values()),
      originalTraceIdByEvaluationTraceId,
      solverTraceIdByEvaluationTraceId,
      solverTraceIds: uniquelyNamedNewTraces.map((trace) => trace.pcb_trace_id),
    }
    return cachedPlan
  }
}
