import {
  applyDrcErrorForces,
  applySafeTraceLayerMoveForError,
  cloneRoutes,
  cloneRoutesForIndexes,
  materializeRoutes,
  materializeRoutesForIndexes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { createPreparedJointDrcEvaluation, type Pipeline9PreparedJointDrcEvaluator } from "./createPreparedJointDrcEvaluation"
import { restoreWorkerConnectivityMap } from "./restoreWorkerConnectivityMap"
import type { ParallelGlobalDrcTrialJob, ParallelGlobalDrcTrialPlacement, ParallelGlobalDrcTrialResult, ParallelGlobalDrcTrialSnapshot } from "./parallelGlobalDrcTrialTypes"
import type { HighDensityRoute } from "high-density-repair03/lib/types/high-density-types"

let cachedContextId: number | undefined
let cachedEvaluator: Pipeline9PreparedJointDrcEvaluator | undefined
let cachedSnapshotId: number | undefined
let cachedSnapshot: ParallelGlobalDrcTrialSnapshot | undefined

function evaluatePlacement(
  job: ParallelGlobalDrcTrialJob,
  evaluator: Pipeline9PreparedJointDrcEvaluator,
  snapshot: ParallelGlobalDrcTrialSnapshot,
  adjustViaClearance: boolean,
): ParallelGlobalDrcTrialPlacement {
  const { trial } = job
  let countedBeforeException = false
  let materializedRoutes: HighDensityRoute[] | undefined
  try {
    const connMap = snapshot.connectivity ? restoreWorkerConnectivityMap(snapshot.connectivity) : undefined
    if (trial.kind === "force-scale") {
      const candidateRoutes = cloneRoutes(snapshot.hdRoutes)
      const changed = applyDrcErrorForces(snapshot.srj, candidateRoutes, [trial.error],
        trial.traceRouteIndexById, trial.scale, connMap, true,
        trial.enableTargetedErrorSweep, trial.canMoveSharedViaSiteWithoutTradingDrcErrors,
        trial.enableTraceViaOwnerTargeting)
      if (!changed) return { status: "unchanged" }
      const routes = materializeRoutes(candidateRoutes)
      materializedRoutes = routes
      countedBeforeException = true
      return { status: "evaluated", routes, preparedEvaluation: evaluator.evaluate(routes) }
    }
    const candidateRoutes = cloneRoutesForIndexes(snapshot.hdRoutes, [trial.changedRouteIndex])
    const changed = applySafeTraceLayerMoveForError(snapshot.srj, candidateRoutes, trial.error,
      trial.changedRouteIndex, trial.targetZ, trial.spanExpansion, connMap,
      trial.directionVariant, adjustViaClearance)
    if (!changed) return { status: "unchanged" }
    const routes = materializeRoutesForIndexes(candidateRoutes, [trial.changedRouteIndex])
    materializedRoutes = routes
    countedBeforeException = true
    return { status: "evaluated", routes, preparedEvaluation: evaluator.evaluate(routes) }
  } catch (error: unknown) {
    const exception = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: "Error", message: String(error) }
    if (countedBeforeException) {
      if (!materializedRoutes) throw new Error("Parallel global DRC evaluation exception lost its materialized routes")
      return { status: "exception", countedBeforeException: true, routes: materializedRoutes,
        candidateKey: JSON.stringify(materializedRoutes), exception }
    }
    return { status: "exception", countedBeforeException: false, exception }
  }
}

/** Geometry trials are speculative; protocol/context failures are never speculative. */
export function executeParallelGlobalDrcTrial(job: ParallelGlobalDrcTrialJob): ParallelGlobalDrcTrialResult {
  if (!Number.isSafeInteger(job.contextId) || job.contextId < 1 ||
    !Number.isSafeInteger(job.snapshotId) || job.snapshotId < 1 ||
    !Number.isSafeInteger(job.trial.trialIndex) || job.trial.trialIndex < 0 ||
    (job.trial.kind !== "force-scale" && job.trial.kind !== "safe-trace-layer")) {
    throw new Error("Invalid parallel global DRC trial request")
  }
  if (cachedContextId !== job.contextId) {
    if (!job.context) throw new Error("Parallel global DRC trial is missing its immutable context")
    cachedEvaluator = createPreparedJointDrcEvaluation(job.context)
    cachedContextId = job.contextId
  }
  if (!cachedEvaluator) throw new Error("Parallel global DRC trial evaluator was not initialized")
  if (cachedSnapshotId !== job.snapshotId) {
    if (!job.snapshot) throw new Error("Parallel global DRC trial is missing its immutable frontier snapshot")
    cachedSnapshot = job.snapshot
    cachedSnapshotId = job.snapshotId
  }
  if (!cachedSnapshot) throw new Error("Parallel global DRC trial frontier snapshot was not initialized")
  const first = evaluatePlacement(job, cachedEvaluator, cachedSnapshot, false)
  const placements = [first]
  if (job.trial.kind === "safe-trace-layer" && (first.status !== "exception" || first.countedBeforeException)) {
    placements.push(evaluatePlacement(job, cachedEvaluator, cachedSnapshot, true))
  }
  return { kind: job.kind, trialIndex: job.trial.trialIndex, placements }
}

/** Validate all deliveries before resolving pool promises, including unused trials. */
export function assertParallelGlobalDrcTrialResult(job: ParallelGlobalDrcTrialJob, value: unknown): asserts value is ParallelGlobalDrcTrialResult {
  if (!value || typeof value !== "object") throw new Error("Invalid parallel global DRC trial response")
  const result = value as Partial<ParallelGlobalDrcTrialResult>
  if (result.kind !== job.kind || result.trialIndex !== job.trial.trialIndex || !Array.isArray(result.placements)) {
    throw new Error("Parallel global DRC trial response does not match its request")
  }
  const first = result.placements[0]
  const expected = job.trial.kind === "force-scale" ||
    (first?.status === "exception" && !first.countedBeforeException) ? 1 : 2
  if (result.placements.length !== expected) throw new Error("Parallel global DRC trial response has an invalid placement count")
  for (const placement of result.placements) {
    if (!placement || typeof placement !== "object") throw new Error("Invalid parallel global DRC trial placement")
    if (placement.status === "unchanged") continue
    if (placement.status === "exception") {
      if (typeof placement.countedBeforeException !== "boolean" || !placement.exception ||
        typeof placement.exception.name !== "string" || typeof placement.exception.message !== "string" ||
        (placement.exception.stack !== undefined && typeof placement.exception.stack !== "string")) {
        throw new Error("Invalid parallel global DRC trial exception")
      }
      if (placement.countedBeforeException && (!Array.isArray(placement.routes) || typeof placement.candidateKey !== "string")) {
        throw new Error("Invalid parallel global DRC evaluation exception candidate")
      }
      continue
    }
    if (placement.status !== "evaluated" || !Array.isArray(placement.routes) ||
      !placement.preparedEvaluation || typeof placement.preparedEvaluation.candidateKey !== "string" ||
      !Array.isArray(placement.preparedEvaluation.evaluatedDrc?.errors) ||
      !Array.isArray(placement.preparedEvaluation.evaluatedDrc?.errorsWithCenters) ||
      !Array.isArray(placement.preparedEvaluation.preparedCandidateDrcInput?.evaluatedTraces) ||
      !Array.isArray(placement.preparedEvaluation.preparedCandidateDrcInput?.routedTraces) ||
      !(placement.preparedEvaluation.preparedCandidateDrcInput?.movableTraceIds instanceof Set) ||
      !(placement.preparedEvaluation.preparedCandidateDrcInput?.originalTraceIdByEvaluationTraceId instanceof Map) ||
      !(placement.preparedEvaluation.preparedCandidateDrcInput?.solverTraceIdByEvaluationTraceId instanceof Map)) {
      throw new Error("Invalid parallel global DRC trial evaluated placement")
    }
  }
}
