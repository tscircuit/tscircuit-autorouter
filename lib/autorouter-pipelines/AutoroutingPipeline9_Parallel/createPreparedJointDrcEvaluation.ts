import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine, type SimpleRouteJson as RepairSimpleRouteJson, type SimplifiedPcbTraces as RepairSimplifiedPcbTraces } from "high-density-repair03/lib"
import { combinePreloadedAndRoutedTraces } from "../../testing/evaluate-relaxed-drc"
import type { Obstacle, SimpleRouteConnection, SimplifiedPcbTrace } from "../../types"
import type { HighDensityRoute } from "../../types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "../../utils/convertHdRouteToSimplifiedRoute"
import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "../AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { assignUniquePcbTraceIdsToNewTraces } from "../AutoroutingPipeline9_PreloadedTraceGraph/assignUniquePcbTraceIdsToNewTraces"
import { Pipeline9MemoizedAutoroutingDrcEngine } from "./repair03/Pipeline9MemoizedAutoroutingDrcEngine"

export type Pipeline9PreparedCandidateDrcInput = {
  evaluatedTraces: SimplifiedPcbTrace[]
  movableTraceIds: ReadonlySet<string>
  originalTraceIdByEvaluationTraceId: ReadonlyMap<string, string>
  routedTraces: SimplifiedPcbTrace[]
  solverTraceIdByEvaluationTraceId: ReadonlyMap<string, string>
}

/** Structured-clone snapshot of the joint evaluator's immutable preparation. */
export type Pipeline9PreparedJointDrcContext = {
  newConnections: SimpleRouteConnection[]
  originalConnections: SimpleRouteConnection[]
  originalPreloadedTraces: SimplifiedPcbTrace[]
  nonMovableMutatedPreloadedTraces: SimplifiedPcbTrace[]
  movablePreloadedSections: Array<{
    originalTrace: SimplifiedPcbTrace
    syntheticConnectionName: string
    evaluationTraceId: string
  }>
  syntheticConnectionNames: string[]
  obstacles: Obstacle[]
  layerCount: number
  defaultViaHoleDiameter: number
  engineSrj: RepairSimpleRouteJson
  engineOptions: Omit<NonNullable<ConstructorParameters<typeof AutoroutingDrcEngine>[1]>, "connMap">
  connectivityNetMap: Record<string, string[]>
  connectivityIdToNetMap: Record<string, string>
}

export type Pipeline9PreparedIndexedDrcEvaluation = {
  candidateKey: string
  preparedCandidateDrcInput: Pipeline9PreparedCandidateDrcInput
  evaluatedDrc: ReturnType<AutoroutingDrcEngine["evaluate"]>
}

export type Pipeline9PreparedJointDrcEvaluator = {
  evaluate: (routes: HighDensityRoute[]) => Pipeline9PreparedIndexedDrcEvaluation
}

/**
 * Worker-side copy of native candidate preparation. The parent still owns
 * candidate-cache consumption, baseline filtering, normalization and reference
 * validation, in the original order. This helper neither publishes routes nor
 * changes the parent solver's logical counters.
 */
export function createPreparedJointDrcEvaluation(
  context: Pipeline9PreparedJointDrcContext,
): Pipeline9PreparedJointDrcEvaluator {
  const connMap = new ConnectivityMap(context.connectivityNetMap)
  // Rebuilding from aliased net arrays alone can change native historical ID
  // ownership. Preserve the original snapshot's exact id-to-net mapping too.
  connMap.idToNetMap = context.connectivityIdToNetMap
  const syntheticConnectionNames = new Set(context.syntheticConnectionNames)
  const convertNewRoutes = createPipeline7HdRoutesToSimplifiedPcbTracesConverter({
    connections: context.newConnections,
    originalConnections: context.originalConnections,
    layerCount: context.layerCount,
    obstacles: context.obstacles,
    defaultViaHoleDiameter: context.defaultViaHoleDiameter,
    connMap,
  })
  const engine = new Pipeline9MemoizedAutoroutingDrcEngine(context.engineSrj, {
    ...context.engineOptions,
    connMap,
  })
  return {
    evaluate(evaluatedRoutes: HighDensityRoute[]): Pipeline9PreparedIndexedDrcEvaluation {
      const candidateKey = JSON.stringify(evaluatedRoutes)
      const evaluatedNewRoutes = evaluatedRoutes.filter(
        (route) => !syntheticConnectionNames.has(route.connectionName),
      )
      const evaluatedNewTraces = convertNewRoutes(evaluatedNewRoutes)
      const uniquelyNamedNewTraces = assignUniquePcbTraceIdsToNewTraces(
        evaluatedNewTraces,
        context.originalPreloadedTraces,
      )
      const replacedOriginalTraceIds = new Set<string>()
      const originalTraceIdByEvaluationTraceId = new Map<string, string>()
      const evaluatedMovablePreloadedTraces = context.movablePreloadedSections.map(
        (movableSection): SimplifiedPcbTrace => {
          const evaluatedRoute = evaluatedRoutes.find(
            (route) => route.connectionName === movableSection.syntheticConnectionName,
          )
          if (!evaluatedRoute) {
            throw new Error(
              `Pipeline9 joint DRC repair lost preloaded section "${movableSection.syntheticConnectionName}"`,
            )
          }
          const originalTraceId = movableSection.originalTrace.pcb_trace_id
          originalTraceIdByEvaluationTraceId.set(movableSection.evaluationTraceId, originalTraceId)
          const replacesOriginalTrace = !replacedOriginalTraceIds.has(originalTraceId)
          replacedOriginalTraceIds.add(originalTraceId)
          return {
            ...movableSection.originalTrace,
            pcb_trace_id: movableSection.evaluationTraceId,
            ...(replacesOriginalTrace
              ? { __replaces_pcb_trace_id: originalTraceId }
              : { __replaces_pcb_trace_id: undefined }),
            route: convertHdRouteToSimplifiedRoute(evaluatedRoute, context.layerCount, {
              defaultViaHoleDiameter: context.defaultViaHoleDiameter,
              obstacles: context.obstacles,
              connMap,
            }),
          }
        },
      )
      const solverTraceIdByEvaluationTraceId = new Map<string, string>()
      for (let traceIndex = 0; traceIndex < evaluatedNewTraces.length; traceIndex++) {
        solverTraceIdByEvaluationTraceId.set(
          uniquelyNamedNewTraces[traceIndex]!.pcb_trace_id,
          evaluatedNewTraces[traceIndex]!.pcb_trace_id,
        )
      }
      for (const movableSection of context.movablePreloadedSections) {
        solverTraceIdByEvaluationTraceId.set(
          movableSection.evaluationTraceId,
          `${movableSection.syntheticConnectionName}_0`,
        )
      }
      const movableTraceIds = new Set(solverTraceIdByEvaluationTraceId.values())
      const routedTraces = [
        ...context.nonMovableMutatedPreloadedTraces,
        ...evaluatedMovablePreloadedTraces,
        ...uniquelyNamedNewTraces,
      ]
      const evaluatedTraces = combinePreloadedAndRoutedTraces(context.originalPreloadedTraces, routedTraces)
      const preparedCandidateDrcInput = {
        evaluatedTraces,
        movableTraceIds,
        originalTraceIdByEvaluationTraceId,
        routedTraces,
        solverTraceIdByEvaluationTraceId,
      }
      return {
        candidateKey,
        preparedCandidateDrcInput,
        evaluatedDrc: engine.evaluate(evaluatedTraces as RepairSimplifiedPcbTraces),
      }
    },
  }
}
