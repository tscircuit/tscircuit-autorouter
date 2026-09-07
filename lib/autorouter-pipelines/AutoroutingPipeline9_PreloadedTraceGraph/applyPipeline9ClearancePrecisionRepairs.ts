import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  DrcEvaluator,
  SimpleRouteJson as RepairSimpleRouteJson,
} from "high-density-repair03/lib"
import {
  applyDrcErrorForces,
  cloneRoutes,
  materializeRoutes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  getPipeline9DrcErrorTraceIds,
  getPipeline9RouteIndexByTraceId,
  type Pipeline9DrcError,
} from "./pipeline9JointDrcRepairUtils"

type ClearancePrecisionRepairResult = {
  routes: HighDensityRoute[]
  attemptedCandidateCount: number
  candidateValidationCount: number
  referenceValidationCount: number
  repaired: boolean
}

type PreparedClearanceErrors = {
  errors: Pipeline9DrcError[]
  deficit: number
}

type IndexedClearanceCandidate = {
  routes: HighDensityRoute[]
  deficit: number
}

type Point = { x: number; y: number }

export type ClearanceMarginDrcEvaluator = (
  routes: HighDensityRoute[],
  targets: Pipeline9DrcError[],
  originalRoutes: HighDensityRoute[],
) => Pipeline9DrcError[]

export const CLEARANCE_PRECISION_MARGIN = 0.01

const MAX_CLEARANCE_ERROR_COUNT = 8
const MAX_PASSES = 8
const FORCE_SCALES = [0.03, 0.1, 0.25]

const getIndexedClearanceDeficit = (
  errors: Pipeline9DrcError[],
): number | undefined => {
  let deficit = 0
  for (const error of errors) {
    if (
      typeof error.actual_clearance !== "number" ||
      !Number.isFinite(error.actual_clearance) ||
      typeof error.minimum_clearance !== "number" ||
      !Number.isFinite(error.minimum_clearance)
    ) {
      return undefined
    }
    deficit += Math.max(0, error.minimum_clearance - error.actual_clearance)
    if (!Number.isFinite(deficit)) return undefined
  }
  return deficit
}

const prepareClearanceErrors = ({
  errors,
  errorsWithCenters,
  routeIndexByTraceId,
  padPositionById,
}: {
  errors: Pipeline9DrcError[]
  errorsWithCenters: Pipeline9DrcError[]
  routeIndexByTraceId: ReadonlyMap<string, number>
  padPositionById: ReadonlyMap<string, Point>
}): PreparedClearanceErrors | undefined => {
  if (errors.length === 0 || errors.length > MAX_CLEARANCE_ERROR_COUNT) {
    return undefined
  }
  const preparedErrors: Pipeline9DrcError[] = []
  let deficit = 0
  for (const error of errors) {
    const isViaTrace = error.type === "pcb_via_trace_clearance_error"
    const isPadTrace = error.type === "pcb_pad_trace_clearance_error"
    if (
      (!isViaTrace && !isPadTrace) ||
      typeof error.pcb_trace_id !== "string" ||
      !routeIndexByTraceId.has(error.pcb_trace_id) ||
      typeof error.actual_clearance !== "number" ||
      !Number.isFinite(error.actual_clearance) ||
      typeof error.minimum_clearance !== "number" ||
      !Number.isFinite(error.minimum_clearance)
    ) {
      return undefined
    }
    const traceIds = getPipeline9DrcErrorTraceIds(error)
    if (
      (isViaTrace && traceIds.length < 2) ||
      traceIds.some((traceId) => !routeIndexByTraceId.has(traceId))
    ) {
      return undefined
    }
    const centeredError = errorsWithCenters.find(
      (candidate) =>
        candidate.type === error.type &&
        candidate.pcb_trace_id === error.pcb_trace_id &&
        candidate.pcb_pad_id === error.pcb_pad_id &&
        candidate.pcb_via_id === error.pcb_via_id,
    )
    const center = isPadTrace
      ? typeof error.pcb_pad_id === "string"
        ? padPositionById.get(error.pcb_pad_id)
        : undefined
      : (centeredError?.center ?? error.center)
    if (!center || typeof center !== "object") return undefined
    const point = center as Record<string, unknown>
    if (
      typeof point.x !== "number" ||
      !Number.isFinite(point.x) ||
      typeof point.y !== "number" ||
      !Number.isFinite(point.y)
    ) {
      return undefined
    }
    preparedErrors.push({ ...error, center: { x: point.x, y: point.y } })
    deficit += Math.max(0, error.minimum_clearance - error.actual_clearance)
    if (!Number.isFinite(deficit)) return undefined
  }
  return { errors: preparedErrors, deficit }
}

/** Searches coupled clearance adjustments, publishing only reference-clean routes. */
export const applyPipeline9ClearancePrecisionRepairs = ({
  srj,
  routes,
  newConnections,
  syntheticConnectionNames,
  connMap,
  indexedDrcEvaluator,
  candidateDrcEvaluator,
  marginDrcEvaluator,
  drcEvaluator,
  initialErrors,
  initialErrorsWithCenters = initialErrors,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  newConnections: SimpleRouteConnection[]
  syntheticConnectionNames: ReadonlySet<string>
  connMap: ConnectivityMap
  indexedDrcEvaluator: DrcEvaluator
  candidateDrcEvaluator: DrcEvaluator
  marginDrcEvaluator: ClearanceMarginDrcEvaluator
  drcEvaluator: DrcEvaluator
  initialErrors: Pipeline9DrcError[]
  initialErrorsWithCenters?: Pipeline9DrcError[]
}): ClearancePrecisionRepairResult => {
  const unchanged: ClearancePrecisionRepairResult = {
    routes,
    attemptedCandidateCount: 0,
    candidateValidationCount: 0,
    referenceValidationCount: 0,
    repaired: false,
  }
  if ((srj.traces?.length ?? 0) > 0 || syntheticConnectionNames.size > 0) {
    return unchanged
  }
  const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
    routes,
    newConnections,
    syntheticConnectionNames,
  })
  const padPositionById = new Map<string, Point>()
  for (const obstacle of srj.obstacles) {
    for (const id of [
      obstacle.obstacleId,
      obstacle.circuitJsonMetadata?.pcb_smtpad_id,
      obstacle.circuitJsonMetadata?.pcb_plated_hole_id,
      obstacle.connectedTo[0],
    ]) {
      if (typeof id === "string") padPositionById.set(id, obstacle.center)
    }
  }
  const initial = prepareClearanceErrors({
    errors: initialErrors,
    errorsWithCenters: initialErrorsWithCenters,
    routeIndexByTraceId,
    padPositionById,
  })
  if (!initial) return unchanged
  let current: PreparedClearanceErrors = initial
  const marginTargets = initial.errors
  const initialMarginErrors = initial.errors.map((error) => ({
    ...error,
    minimum_clearance:
      (error.minimum_clearance as number) + CLEARANCE_PRECISION_MARGIN,
  }))
  const initialMarginDeficit = getIndexedClearanceDeficit(initialMarginErrors)
  if (initialMarginDeficit === undefined) return unchanged
  let currentMargin: PreparedClearanceErrors = {
    errors: initialMarginErrors,
    deficit: initialMarginDeficit,
  }
  let currentRoutes = routes
  let attemptedCandidateCount = 0
  let candidateValidationCount = 0
  let referenceValidationCount = 0
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // Keep the original failing pairs active until their physical gaps have
    // margin, even after the relaxed checker stops reporting those pairs.
    const forceErrorsByPair = new Map<string, Pipeline9DrcError>()
    for (const error of [...currentMargin.errors, ...current.errors]) {
      const pairKey = JSON.stringify([
        error.type,
        error.pcb_trace_id,
        error.pcb_pad_id,
        error.pcb_via_id,
      ])
      forceErrorsByPair.set(pairKey, error)
    }
    const forceErrors = [...forceErrorsByPair.values()]
    let bestCandidate: IndexedClearanceCandidate | undefined
    for (const scale of FORCE_SCALES) {
      const candidateRoutes = cloneRoutes(currentRoutes)
      const changed = applyDrcErrorForces(
        srj as RepairSimpleRouteJson,
        candidateRoutes,
        forceErrors,
        routeIndexByTraceId,
        scale,
        connMap,
        true,
        true,
        true,
        false,
      )
      if (!changed) continue
      const materializedRoutes = materializeRoutes(candidateRoutes)
      attemptedCandidateCount++
      const indexedResult = indexedDrcEvaluator({
        traces: [],
        routes: materializedRoutes,
        hdRoutes: materializedRoutes,
      })
      const deficit = getIndexedClearanceDeficit(
        Array.isArray(indexedResult) ? indexedResult : indexedResult.errors,
      )
      // Conservative indexed errors rank candidates only. Their absence never
      // establishes that a candidate is reference-clean.
      if (
        deficit !== undefined &&
        (!bestCandidate || deficit < bestCandidate.deficit)
      ) {
        bestCandidate = { routes: materializedRoutes, deficit }
      }
    }
    if (!bestCandidate) break
    candidateValidationCount++
    const candidateResult = candidateDrcEvaluator({
      traces: [],
      routes: bestCandidate.routes,
      hdRoutes: bestCandidate.routes,
    })
    const candidateErrors = Array.isArray(candidateResult)
      ? candidateResult
      : candidateResult.errors
    const prepared =
      candidateErrors.length === 0
        ? { errors: [], deficit: 0 }
        : prepareClearanceErrors({
            errors: candidateErrors,
            errorsWithCenters: Array.isArray(candidateResult)
              ? candidateResult
              : (candidateResult.errorsWithCenters ?? candidateResult.errors),
            routeIndexByTraceId,
            padPositionById,
          })
    if (!prepared) break
    // Measure only the selected candidate. Indexed ranking stays bounded to
    // the existing three candidates without repeating exact margin checks.
    const marginErrors = marginDrcEvaluator(
      bestCandidate.routes,
      marginTargets,
      routes,
    )
    const preparedMargin =
      marginErrors.length === 0
        ? { errors: [], deficit: 0 }
        : prepareClearanceErrors({
            errors: marginErrors,
            errorsWithCenters: marginErrors,
            routeIndexByTraceId,
            padPositionById,
          })
    if (!preparedMargin) break
    if (candidateErrors.length === 0 && marginErrors.length === 0) {
      // Private geometry validation omits continuity. Publish only after every
      // full reference check passes, including continuity and errors with no center.
      referenceValidationCount++
      const referenceResult = drcEvaluator({
        traces: [],
        routes: bestCandidate.routes,
        hdRoutes: bestCandidate.routes,
      })
      const referenceErrors = Array.isArray(referenceResult)
        ? referenceResult
        : referenceResult.errors
      if (referenceErrors.length === 0) {
        return {
          routes: bestCandidate.routes,
          attemptedCandidateCount,
          candidateValidationCount,
          referenceValidationCount,
          repaired: true,
        }
      }
      break
    }
    // A coupled move can temporarily split one deficit between two objects.
    // Such intermediate routes stay private until every reference error clears.
    if (
      prepared.deficit + preparedMargin.deficit >=
      current.deficit + currentMargin.deficit - 1e-9
    ) {
      break
    }
    currentRoutes = bestCandidate.routes
    current = prepared
    currentMargin = preparedMargin
  }
  return {
    routes,
    attemptedCandidateCount,
    candidateValidationCount,
    referenceValidationCount,
    repaired: false,
  }
}
