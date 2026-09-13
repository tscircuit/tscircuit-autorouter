import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  DrcEvaluator,
  SimpleRouteJson as RepairSimpleRouteJson,
} from "high-density-repair03/lib"
import { GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import {
  applyDrcErrorForces,
  applyTracePairLayerMoveForError,
  cloneRoutes,
  materializeRoutes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
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

type Point = { x: number; y: number }

type PreparedClearanceError = {
  pcb_trace_id: string
  actual_clearance: number
  minimum_clearance: number
  center: Point
} & (
  | {
      type: "pcb_via_trace_clearance_error"
      pcb_via_id: string
      pcb_pad_id?: undefined
    }
  | {
      type: "pcb_pad_trace_clearance_error"
      pcb_pad_id: string
      pcb_via_id?: undefined
    }
  | {
      type: "pcb_trace_error"
      pcb_trace_ids: string[]
      pcb_pad_id?: undefined
      pcb_via_id?: undefined
    }
)

type PreparedClearanceErrors = {
  errors: PreparedClearanceError[]
  deficit: number
}

type IndexedClearanceCandidate = {
  routes: HighDensityRoute[]
  deficit: number
}

export type ClearanceMarginMeasurement =
  | { status: "measured"; errors: Pipeline9DrcError[] }
  | { status: "unsupported-identity" }

export type ClearanceMarginDrcEvaluator = (
  routes: HighDensityRoute[],
  targets: Pipeline9DrcError[],
  originalRoutes: HighDensityRoute[],
) => ClearanceMarginMeasurement

export const CLEARANCE_PRECISION_MARGIN = 0.01

const MAX_PASSES = 8
const FORCE_SCALES = [0.03, 0.1, 0.18, 0.25]

const getTracePairGap = (error: Pipeline9DrcError): number | undefined => {
  if (error.type !== "pcb_trace_error") return undefined
  const message = typeof error.message === "string" ? error.message : ""
  const match = message.match(/gap: (-?\d+(?:\.\d+)?)mm/)
  if (!match) {
    return /overlaps|accidental contact/.test(message) ? 0 : undefined
  }
  const gap = Number.parseFloat(match[1]!)
  return Number.isFinite(gap) ? gap : undefined
}

const getIndexedClearanceDeficit = (
  errors: Pipeline9DrcError[],
  traceClearance: number,
): number | undefined => {
  let deficit = 0
  for (const error of errors) {
    const actualClearance =
      typeof error.actual_clearance === "number"
        ? error.actual_clearance
        : getTracePairGap(error)
    const minimumClearance =
      typeof error.minimum_clearance === "number"
        ? error.minimum_clearance
        : error.type === "pcb_trace_error"
          ? traceClearance
          : undefined
    if (
      actualClearance === undefined ||
      !Number.isFinite(actualClearance) ||
      minimumClearance === undefined ||
      !Number.isFinite(minimumClearance)
    ) {
      return undefined
    }
    deficit += Math.max(0, minimumClearance - actualClearance)
    if (!Number.isFinite(deficit)) return undefined
  }
  return deficit
}

const prepareClearanceErrors = ({
  errors,
  errorsWithCenters,
  routeIndexByTraceId,
  padPositionById,
  traceClearance,
}: {
  errors: Pipeline9DrcError[]
  errorsWithCenters: Pipeline9DrcError[]
  routeIndexByTraceId: ReadonlyMap<string, number>
  padPositionById: ReadonlyMap<string, Point>
  traceClearance: number
}): PreparedClearanceErrors | undefined => {
  const preparedErrors: PreparedClearanceError[] = []
  let deficit = 0
  for (const error of errors) {
    const isViaTrace = error.type === "pcb_via_trace_clearance_error"
    const isPadTrace = error.type === "pcb_pad_trace_clearance_error"
    const traceIds = getPipeline9DrcErrorTraceIds(error)
    const isTracePair =
      error.type === "pcb_trace_error" &&
      typeof error.pcb_via_id !== "string" &&
      (!Array.isArray(error.pcb_via_ids) || error.pcb_via_ids.length === 0) &&
      traceIds.length === 2
    const actualClearance =
      typeof error.actual_clearance === "number"
        ? error.actual_clearance
        : isTracePair
          ? getTracePairGap(error)
          : undefined
    const minimumClearance =
      typeof error.minimum_clearance === "number"
        ? error.minimum_clearance
        : isTracePair
          ? traceClearance
          : undefined
    if (
      (!isViaTrace && !isPadTrace && !isTracePair) ||
      typeof error.pcb_trace_id !== "string" ||
      !routeIndexByTraceId.has(error.pcb_trace_id) ||
      actualClearance === undefined ||
      !Number.isFinite(actualClearance) ||
      minimumClearance === undefined ||
      !Number.isFinite(minimumClearance)
    ) {
      return undefined
    }
    if (
      ((isViaTrace || isTracePair) && traceIds.length < 2) ||
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
    if (
      !("x" in center) ||
      !("y" in center) ||
      typeof center.x !== "number" ||
      !Number.isFinite(center.x) ||
      typeof center.y !== "number" ||
      !Number.isFinite(center.y)
    ) {
      return undefined
    }
    const measuredError = {
      ...error,
      pcb_trace_id: error.pcb_trace_id,
      actual_clearance: actualClearance,
      minimum_clearance: minimumClearance,
      center: { x: center.x, y: center.y },
    }
    if (isViaTrace) {
      if (typeof error.pcb_via_id !== "string") return undefined
      preparedErrors.push({
        ...measuredError,
        type: "pcb_via_trace_clearance_error",
        pcb_via_id: error.pcb_via_id,
        pcb_pad_id: undefined,
      })
    } else if (isPadTrace) {
      if (typeof error.pcb_pad_id !== "string") return undefined
      preparedErrors.push({
        ...measuredError,
        type: "pcb_pad_trace_clearance_error",
        pcb_pad_id: error.pcb_pad_id,
        pcb_via_id: undefined,
      })
    } else {
      preparedErrors.push({
        ...measuredError,
        type: "pcb_trace_error",
        pcb_trace_ids: traceIds,
        pcb_pad_id: undefined,
        pcb_via_id: undefined,
      })
    }
    deficit += Math.max(0, minimumClearance - actualClearance)
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
  if (initialErrors.length === 0) return unchanged
  const traceClearance =
    srj.minTraceToPadEdgeClearance ??
    RELAXED_DRC_OPTIONS.traceClearance ??
    0.1
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
    traceClearance,
  })
  if (!initial) return unchanged
  let current: PreparedClearanceErrors = initial
  const marginTargets = initial.errors
  const initialMarginErrors = initial.errors.map((error) => ({
    ...error,
    minimum_clearance: error.minimum_clearance + CLEARANCE_PRECISION_MARGIN,
  }))
  const initialMarginDeficit = getIndexedClearanceDeficit(
    initialMarginErrors,
    traceClearance,
  )
  if (initialMarginDeficit === undefined) return unchanged
  let currentMargin: PreparedClearanceErrors = {
    errors: initialMarginErrors,
    deficit: initialMarginDeficit,
  }
  let currentRoutes = routes
  let attemptedCandidateCount = 0
  let candidateValidationCount = 0
  let referenceValidationCount = 0
  if (
    initial.errors.length === 1 &&
    initial.errors[0]?.type === "pcb_trace_error"
  ) {
    const tracePairError = initial.errors[0]
    for (const routeSide of [0, 1] as const) {
      for (let targetZ = 0; targetZ < srj.layerCount; targetZ++) {
        for (const spanExpansion of [1, 3, 5]) {
          const layerCandidateRoutes = cloneRoutes(routes)
          const changed = applyTracePairLayerMoveForError(
            srj as RepairSimpleRouteJson,
            layerCandidateRoutes,
            tracePairError,
            routeIndexByTraceId,
            routeSide,
            targetZ,
            spanExpansion,
            connMap,
            srj.minViaHoleDiameter,
          )
          if (!changed) continue
          attemptedCandidateCount++
          const exactRepairSolver = new GlobalDrcForceImproveSolver({
            srj: { ...srj, traces: undefined } as RepairSimpleRouteJson,
            hdRoutes: materializeRoutes(layerCandidateRoutes),
            connMap,
            effort: 1,
            drcEvaluator,
            maxIterations: 12,
            enableLargeBoardBroadFallback: false,
            enableTargetedErrorSweep: true,
            enablePostSolveClearanceRelaxation: false,
            enableSafeTraceLayerMoves: false,
            enableViaInPadLayerMoves: false,
          })
          exactRepairSolver.solve()
          if (exactRepairSolver.failed) {
            throw new Error(
              `Pipeline9 trace-pair layer repair failed: ${exactRepairSolver.error ?? "unknown error"}`,
            )
          }
          candidateValidationCount++
          const candidateRoutes = exactRepairSolver.getOutput()
          const candidateResult = drcEvaluator({
            traces: [],
            routes: candidateRoutes,
            hdRoutes: candidateRoutes,
          })
          referenceValidationCount++
          const candidateErrors = Array.isArray(candidateResult)
            ? candidateResult
            : candidateResult.errors
          if (candidateErrors.length === 0) {
            return {
              routes: candidateRoutes,
              attemptedCandidateCount,
              candidateValidationCount,
              referenceValidationCount,
              repaired: true,
            }
          }
        }
      }
    }
  }
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // Keep the original failing pairs active until their physical gaps have
    // margin, even after the relaxed checker stops reporting those pairs.
    const forceErrorsByPair = new Map<string, PreparedClearanceError>()
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
    const candidates: IndexedClearanceCandidate[] = []
    const addCandidate = (candidateRoutes: HighDensityRoute[]): void => {
      const materializedRoutes = materializeRoutes(candidateRoutes)
      attemptedCandidateCount++
      const indexedResult = indexedDrcEvaluator({
        traces: [],
        routes: materializedRoutes,
        hdRoutes: materializedRoutes,
      })
      const deficit = getIndexedClearanceDeficit(
        Array.isArray(indexedResult) ? indexedResult : indexedResult.errors,
        traceClearance,
      )
      // Conservative indexed errors rank candidates only. Their absence never
      // establishes that a candidate is reference-clean.
      if (deficit !== undefined) {
        candidates.push({ routes: materializedRoutes, deficit })
      }
    }
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
      addCandidate(candidateRoutes)
    }
    if (candidates.length === 0) break
    candidates.sort((left, right) => left.deficit - right.deficit)
    let bestImprovement:
      | {
          candidate: IndexedClearanceCandidate
          prepared: PreparedClearanceErrors
          preparedMargin: PreparedClearanceErrors
        }
      | undefined
    for (const candidate of candidates) {
      candidateValidationCount++
      const candidateResult = candidateDrcEvaluator({
        traces: [],
        routes: candidate.routes,
        hdRoutes: candidate.routes,
      })
      const candidateErrors = Array.isArray(candidateResult)
        ? candidateResult
        : candidateResult.errors
      const prepared = prepareClearanceErrors({
        errors: candidateErrors,
        errorsWithCenters: Array.isArray(candidateResult)
          ? candidateResult
          : (candidateResult.errorsWithCenters ?? candidateResult.errors),
        routeIndexByTraceId,
        padPositionById,
        traceClearance,
      })
      if (!prepared) continue
      const marginMeasurement = marginDrcEvaluator(
        candidate.routes,
        marginTargets,
        routes,
      )
      if (marginMeasurement.status === "unsupported-identity") {
        if (candidateErrors.length === 0) {
          referenceValidationCount++
          const referenceResult = drcEvaluator({
            traces: [],
            routes: candidate.routes,
            hdRoutes: candidate.routes,
          })
          const referenceErrors = Array.isArray(referenceResult)
            ? referenceResult
            : referenceResult.errors
          if (referenceErrors.length === 0) {
            return {
              routes: candidate.routes,
              attemptedCandidateCount,
              candidateValidationCount,
              referenceValidationCount,
              repaired: true,
            }
          }
          continue
        }
        const unsupportedMarginErrors = prepared.errors.map((error) => ({
          ...error,
          minimum_clearance:
            error.minimum_clearance + CLEARANCE_PRECISION_MARGIN,
        }))
        const unsupportedMarginDeficit = getIndexedClearanceDeficit(
          unsupportedMarginErrors,
          traceClearance,
        )
        if (unsupportedMarginDeficit === undefined) continue
        const preparedMargin = {
          errors: unsupportedMarginErrors,
          deficit: unsupportedMarginDeficit,
        }
        const combinedDeficit = prepared.deficit + preparedMargin.deficit
        const bestCombinedDeficit = bestImprovement
          ? bestImprovement.prepared.deficit +
            bestImprovement.preparedMargin.deficit
          : Number.POSITIVE_INFINITY
        if (
          combinedDeficit <
            current.deficit + currentMargin.deficit - 1e-9 &&
          combinedDeficit < bestCombinedDeficit
        ) {
          bestImprovement = { candidate, prepared, preparedMargin }
        }
        continue
      }
      const marginErrors = marginMeasurement.errors
      const preparedMargin = prepareClearanceErrors({
        errors: marginErrors,
        errorsWithCenters: marginErrors,
        routeIndexByTraceId,
        padPositionById,
        traceClearance,
      })
      if (!preparedMargin) continue
      if (candidateErrors.length === 0 && marginErrors.length === 0) {
        // Private geometry validation omits continuity. Publish only after every
        // full reference check passes, including continuity and errors with no center.
        referenceValidationCount++
        const referenceResult = drcEvaluator({
          traces: [],
          routes: candidate.routes,
          hdRoutes: candidate.routes,
        })
        const referenceErrors = Array.isArray(referenceResult)
          ? referenceResult
          : referenceResult.errors
        if (referenceErrors.length === 0) {
          return {
            routes: candidate.routes,
            attemptedCandidateCount,
            candidateValidationCount,
            referenceValidationCount,
            repaired: true,
          }
        }
        continue
      }
      const combinedDeficit = prepared.deficit + preparedMargin.deficit
      const bestCombinedDeficit = bestImprovement
        ? bestImprovement.prepared.deficit +
          bestImprovement.preparedMargin.deficit
        : Number.POSITIVE_INFINITY
      if (
        combinedDeficit <
          current.deficit + currentMargin.deficit - 1e-9 &&
        combinedDeficit < bestCombinedDeficit
      ) {
        bestImprovement = { candidate, prepared, preparedMargin }
      }
    }
    if (!bestImprovement) break
    // A coupled move can temporarily split one deficit between two objects.
    // Such intermediate routes stay private until every reference error clears.
    currentRoutes = bestImprovement.candidate.routes
    current = bestImprovement.prepared
    currentMargin = bestImprovement.preparedMargin
  }
  return {
    routes,
    attemptedCandidateCount,
    candidateValidationCount,
    referenceValidationCount,
    repaired: false,
  }
}
