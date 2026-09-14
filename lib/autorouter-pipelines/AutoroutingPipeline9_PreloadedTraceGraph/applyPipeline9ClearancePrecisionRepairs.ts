import { pointToSegmentClosestPoint } from "@tscircuit/math-utils"
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
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
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

const getIndexedClearanceDeficit = (
  errors: Pipeline9DrcError[],
  traceClearance: number,
): number | undefined => {
  let deficit = 0
  for (const error of errors) {
    const message = typeof error.message === "string" ? error.message : ""
    const gapMatch = message.match(/gap: (-?\d+(?:\.\d+)?)mm/)
    const actualClearance =
      typeof error.actual_clearance === "number"
        ? error.actual_clearance
        : gapMatch
          ? Number.parseFloat(gapMatch[1]!)
          : undefined
    const minimumClearance =
      typeof error.minimum_clearance === "number"
        ? error.minimum_clearance
        : error.type === "pcb_trace_error"
          ? traceClearance
          : undefined
    if (
      typeof actualClearance !== "number" ||
      !Number.isFinite(actualClearance) ||
      typeof minimumClearance !== "number" ||
      !Number.isFinite(minimumClearance)
    ) {
      return undefined
    }
    deficit += Math.max(0, minimumClearance - actualClearance)
    if (!Number.isFinite(deficit)) return undefined
  }
  return deficit
}

const getPadTraceForceCenter = ({
  error,
  routes,
  routeIndexByTraceId,
  padObstacle,
  layerCount,
}: {
  error: Pipeline9DrcError
  routes: HighDensityRoute[]
  routeIndexByTraceId: ReadonlyMap<string, number>
  padObstacle: SimpleRouteJson["obstacles"][number]
  layerCount: number
}): Point | undefined => {
  if (typeof error.pcb_trace_id !== "string") return undefined
  const routeIndex = routeIndexByTraceId.get(error.pcb_trace_id)
  const route = routeIndex === undefined ? undefined : routes[routeIndex]
  if (!route) return undefined

  const rotationRadians =
    ((padObstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cos = Math.cos(rotationRadians)
  const sin = Math.sin(rotationRadians)
  const toLocal = (point: Point): Point => {
    const offsetX = point.x - padObstacle.center.x
    const offsetY = point.y - padObstacle.center.y
    return {
      x: offsetX * cos + offsetY * sin,
      y: -offsetX * sin + offsetY * cos,
    }
  }
  const isInsidePad = (point: Point): boolean => {
    const local = toLocal(point)
    return (
      Math.abs(local.x) <= padObstacle.width / 2 &&
      Math.abs(local.y) <= padObstacle.height / 2
    )
  }
  const localCorners = [
    { x: -padObstacle.width / 2, y: -padObstacle.height / 2 },
    { x: padObstacle.width / 2, y: -padObstacle.height / 2 },
    { x: padObstacle.width / 2, y: padObstacle.height / 2 },
    { x: -padObstacle.width / 2, y: padObstacle.height / 2 },
  ]
  const corners = localCorners.map((corner) => ({
    x: padObstacle.center.x + corner.x * cos - corner.y * sin,
    y: padObstacle.center.y + corner.x * sin + corner.y * cos,
  }))
  const obstacleLayers = new Set(
    padObstacle.zLayers ??
      padObstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount)),
  )
  let closest:
    | {
        distance: number
        center: Point
      }
    | undefined
  for (let pointIndex = 1; pointIndex < route.route.length; pointIndex++) {
    const start = route.route[pointIndex - 1]!
    const end = route.route[pointIndex]!
    if (start.z !== end.z || !obstacleLayers.has(start.z)) continue
    // Pad-clearance display centers can be far from the offending copper on
    // elongated or rotated pads. Rank route segments by the physical pad
    // boundary, then give the force solver a point on the actual segment.
    const distance =
      isInsidePad(start) || isInsidePad(end)
        ? 0
        : Math.min(
            ...corners.map((corner, cornerIndex) =>
              minimumDistanceBetweenSegments(
                start,
                end,
                corner,
                corners[(cornerIndex + 1) % corners.length]!,
              ),
            ),
          )
    if (!closest || distance < closest.distance) {
      closest = {
        distance,
        center: pointToSegmentClosestPoint(padObstacle.center, start, end),
      }
    }
  }
  return closest?.center
}

const prepareClearanceErrors = ({
  errors,
  errorsWithCenters,
  routeIndexByTraceId,
  routes,
  padObstacleById,
  layerCount,
  traceClearance,
}: {
  errors: Pipeline9DrcError[]
  errorsWithCenters: Pipeline9DrcError[]
  routeIndexByTraceId: ReadonlyMap<string, number>
  routes: HighDensityRoute[]
  padObstacleById: ReadonlyMap<
    string,
    SimpleRouteJson["obstacles"][number]
  >
  layerCount: number
  traceClearance: number
}): PreparedClearanceErrors | undefined => {
  const preparedErrors: PreparedClearanceError[] = []
  let deficit = 0
  for (const error of errors) {
    const isViaTrace = error.type === "pcb_via_trace_clearance_error"
    const isPadTrace = error.type === "pcb_pad_trace_clearance_error"
    const traceIds = getPipeline9DrcErrorTraceIds(error)
    const isTracePair = error.type === "pcb_trace_error" && traceIds.length >= 2
    const mutableTraceId = isTracePair
      ? traceIds.find((traceId) => routeIndexByTraceId.has(traceId))
      : typeof error.pcb_trace_id === "string"
        ? error.pcb_trace_id
        : undefined
    const message = typeof error.message === "string" ? error.message : ""
    const gapMatch = message.match(/gap: (-?\d+(?:\.\d+)?)mm/)
    const measuredClearance =
      typeof error.actual_clearance === "number"
        ? error.actual_clearance
        : gapMatch
          ? Number.parseFloat(gapMatch[1]!)
          : undefined
    const requiredClearance =
      typeof error.minimum_clearance === "number"
        ? error.minimum_clearance
        : isTracePair
          ? traceClearance
          : undefined
    if (
      (!isViaTrace && !isPadTrace && !isTracePair) ||
      typeof mutableTraceId !== "string" ||
      !routeIndexByTraceId.has(mutableTraceId) ||
      typeof measuredClearance !== "number" ||
      !Number.isFinite(measuredClearance) ||
      typeof requiredClearance !== "number" ||
      !Number.isFinite(requiredClearance)
    ) {
      return undefined
    }
    if (
      (isViaTrace && traceIds.length < 2) ||
      (isViaTrace &&
        traceIds.some((traceId) => !routeIndexByTraceId.has(traceId)))
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
        ? (() => {
            const padObstacle = padObstacleById.get(error.pcb_pad_id)
            return padObstacle
              ? (getPadTraceForceCenter({
                  error,
                  routes,
                  routeIndexByTraceId,
                  padObstacle,
                  layerCount,
                }) ?? padObstacle.center)
              : undefined
          })()
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
      pcb_trace_id: mutableTraceId,
      actual_clearance: measuredClearance,
      minimum_clearance: requiredClearance,
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
    deficit += Math.max(0, requiredClearance - measuredClearance)
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
  const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
    routes,
    newConnections,
    syntheticConnectionNames,
  })
  const padObstacleById = new Map<
    string,
    SimpleRouteJson["obstacles"][number]
  >()
  for (const obstacle of srj.obstacles) {
    for (const id of [
      obstacle.obstacleId,
      obstacle.circuitJsonMetadata?.pcb_smtpad_id,
      obstacle.circuitJsonMetadata?.pcb_plated_hole_id,
      obstacle.connectedTo[0],
    ]) {
      if (typeof id === "string") padObstacleById.set(id, obstacle)
    }
  }
  const initial = prepareClearanceErrors({
    errors: initialErrors,
    errorsWithCenters: initialErrorsWithCenters,
    routeIndexByTraceId,
    routes,
    padObstacleById,
    layerCount: srj.layerCount,
    traceClearance: srj.minTraceToPadEdgeClearance ?? 0.1,
  })
  if (!initial) return unchanged
  let current: PreparedClearanceErrors = initial
  const marginTargets = initial.errors
  const initialMarginErrors = initial.errors.map((error) => ({
    ...error,
    minimum_clearance: error.minimum_clearance + CLEARANCE_PRECISION_MARGIN,
  }))
  const traceClearance = srj.minTraceToPadEdgeClearance ?? 0.1
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
        traceClearance,
      )
      // Conservative indexed errors rank candidates only. Their absence never
      // establishes that a candidate is reference-clean.
      if (deficit !== undefined) {
        candidates.push({ routes: materializedRoutes, deficit })
      }
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
        routes: candidate.routes,
        padObstacleById,
        layerCount: srj.layerCount,
        traceClearance: srj.minTraceToPadEdgeClearance ?? 0.1,
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
        if (
          prepared.deficit < current.deficit - 1e-9 &&
          prepared.deficit <
            (bestImprovement?.prepared.deficit ?? Number.POSITIVE_INFINITY)
        ) {
          // Synthetic preload identities cannot always be remeasured by the
          // private margin evaluator. Keep strict reference-DRC improvements
          // private so later passes can finish a coupled repair; publication
          // still requires a clean full reference validation above.
          bestImprovement = {
            candidate,
            prepared,
            preparedMargin: currentMargin,
          }
        }
        continue
      }
      const marginErrors = marginMeasurement.errors
      const preparedMargin = prepareClearanceErrors({
        errors: marginErrors,
        errorsWithCenters: marginErrors,
        routeIndexByTraceId,
        routes: candidate.routes,
        padObstacleById,
        layerCount: srj.layerCount,
        traceClearance: srj.minTraceToPadEdgeClearance ?? 0.1,
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
