import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "high-density-repair03/lib"
import {
  getForceScalesForEffort,
  getMaxTargetedCandidateAttemptsForEffort,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import {
  applyDrcErrorForces,
  applyTracePairSegmentDisplacementForError,
  getTraceRoutePairForError,
  materializeRoutesForIndexes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import {
  applyPipeline9PadTraceForce,
  getPipeline9PadTraceForceMobility,
} from "./applyPipeline9PadTraceForce"
import type { Pipeline9HighDensityForceContext } from "./getPipeline9HighDensityForceObstacles"
import { getPipeline9PadCopperForceTarget } from "./getPipeline9PadCopperForceTarget"
import { isPipeline9HighDensityRouteInsideBounds } from "./isPipeline9HighDensityRouteInsideBounds"
import {
  getPipeline9DrcErrorTraceIds,
  type Pipeline9DrcError,
} from "./pipeline9JointDrcRepairUtils"

type HighDensityPoint = HighDensityRoute["route"][number]
type ForceErrorTarget =
  | { kind: "native"; error: Pipeline9DrcError }
  | {
      kind: "pad"
      error: Pipeline9DrcError
      pad: Record<string, unknown>
    }

type LocalForceRoute = {
  original: HighDensityRoute
  mutable: HighDensityRoute
  originalPoints: HighDensityPoint[]
  originalPointByMutablePoint: Map<HighDensityPoint, HighDensityPoint>
  protectedPointIndexes: Set<number>
  throughObstacleSpanStartIndexes: ReadonlySet<number>
  terminalPrefixLength: number
  terminalSuffixLength: number
}

export type Pipeline9HighDensityForceFamily =
  | "pad-wire"
  | "pad-wire-0"
  | "pad-wire-1"
  | "native"
  | "native-feedback"
  | "trace-pair-0"
  | "trace-pair-1"

type ForceFamilyState = {
  family: Pipeline9HighDensityForceFamily
  localRoutes: LocalForceRoute[]
  mutableRoutes: HighDensityRoute[]
  exhausted: boolean
}

export type Pipeline9HighDensityForceFeedback =
  | { errors: Pipeline9DrcError[] }
  | undefined

type NativeFeedbackState = {
  state: ForceFamilyState
  errors: Pipeline9DrcError[]
}

type ForcePass = {
  scaleIndex: number
  scale: number
  applicationStart: number
  applicationEnd: number
}

export type Pipeline9HighDensityForceRejectionReason =
  | "no-motion"
  | "anchor"
  | "geometry"

export type Pipeline9HighDensityForceCandidateParams = {
  node: NodeWithPortPoints
  hdRoutes: HighDensityRoute[]
  errors: Pipeline9DrcError[]
  traceRouteIndexById: Map<string, number>
  obstacles: Obstacle[]
  layerCount: number
  viaDiameter: number
  viaHoleDiameter: number
  traceWidth: number
  obstacleMargin: number
  connMap: ConnectivityMap
  forceContext: Pipeline9HighDensityForceContext
  effort: number
  /** Reports the original error index before private pad-center expansion. */
  onErrorAttempted?: (errorIndex: number) => void
  /** Original slot scale; native-feedback applies +1 in a redundant -1 slot. */
  onCandidateAttempted?: (
    family: Pipeline9HighDensityForceFamily,
    scale: number,
    application: number,
  ) => void
  onCandidateRejected?: (
    reason: Pipeline9HighDensityForceRejectionReason,
  ) => void
}

const getOriginalThroughObstacleSpanStartIndexes = (
  original: HighDensityRoute,
  layerCount: number,
  obstacles: Obstacle[],
  connMap: ConnectivityMap,
): ReadonlySet<number> => {
  const spanStartIndexes = new Set<number>()
  for (let index = 0; index < original.route.length - 1; index++) {
    const start = original.route[index]!
    const end = original.route[index + 1]!
    if (start.toNextSegmentType === "through_obstacle") {
      spanStartIndexes.add(index)
      continue
    }
    if (start.z === end.z) continue
    // Ordinary HD repair can drop point tags. Serialize this original edge
    // through the official converter, retaining its exact connected-pad
    // predicate without confusing repeated coordinates elsewhere in the route.
    const serializedSpan = convertHdRouteToSimplifiedRoute(
      { ...original, route: [start, end] },
      layerCount,
      { obstacles, connMap },
    )
    if (
      serializedSpan.some(
        (segment) => segment.route_type === "through_obstacle",
      )
    ) {
      spanStartIndexes.add(index)
    }
  }
  return spanStartIndexes
}

const createLocalForceRoute = (
  original: HighDensityRoute,
  throughObstacleSpanStartIndexes: ReadonlySet<number>,
): LocalForceRoute => {
  const originalPoints = original.route.map((point) => ({ ...point }))
  const first = originalPoints[0]
  const last = originalPoints.at(-1)
  if (!first || !last) {
    throw new Error("Pipeline9 local DRC forces require nonempty routes")
  }
  // Earlier HD stages keep terminal identity on the route rather than on its
  // points. The force operator needs the real identity on each temporary end
  // point so it searches interior moves instead of moving a connected pad end.
  if (
    first.pcb_port_id === undefined &&
    original.startPcbPortId !== undefined
  ) {
    first.pcb_port_id = original.startPcbPortId
  }
  if (last.pcb_port_id === undefined && original.endPcbPortId !== undefined) {
    last.pcb_port_id = original.endPcbPortId
  }
  for (const index of throughObstacleSpanStartIndexes) {
    originalPoints[index]!.toNextSegmentType = "through_obstacle"
  }
  const protectedPointIndexes = new Set<number>()
  let terminalPrefixLength = 0
  let terminalSuffixLength = 0
  while (
    terminalPrefixLength < originalPoints.length &&
    originalPoints[terminalPrefixLength]!.x === first.x &&
    originalPoints[terminalPrefixLength]!.y === first.y
  ) {
    protectedPointIndexes.add(terminalPrefixLength++)
  }
  while (
    terminalSuffixLength < originalPoints.length &&
    originalPoints[originalPoints.length - terminalSuffixLength - 1]!.x ===
      last.x &&
    originalPoints[originalPoints.length - terminalSuffixLength - 1]!.y ===
      last.y
  ) {
    protectedPointIndexes.add(originalPoints.length - ++terminalSuffixLength)
  }
  for (let index = 0; index < originalPoints.length; index++) {
    const point = originalPoints[index]!
    if (point.pcb_port_id || point.insideJumperPad) {
      protectedPointIndexes.add(index)
    }
    if (point.toNextSegmentType === "through_obstacle") {
      protectedPointIndexes.add(index)
      protectedPointIndexes.add(index + 1)
    }
  }
  return {
    original,
    originalPoints,
    originalPointByMutablePoint: new Map(
      originalPoints.map((point, index) => [point, original.route[index]!]),
    ),
    protectedPointIndexes,
    throughObstacleSpanStartIndexes,
    terminalPrefixLength,
    terminalSuffixLength,
    mutable: {
      ...original,
      route: [...originalPoints],
      vias: original.vias.map((via) => ({ ...via })),
    },
  }
}

const hasPreservedLocalRouteAnchors = (local: LocalForceRoute): boolean => {
  const points = local.mutable.route
  for (const index of local.protectedPointIndexes) {
    const point = local.originalPoints[index]
    const originalPoint = local.original.route[index]
    if (
      !point ||
      !originalPoint ||
      !points.includes(point) ||
      point.x !== originalPoint.x ||
      point.y !== originalPoint.y ||
      point.z !== originalPoint.z
    ) {
      return false
    }
    if (
      local.throughObstacleSpanStartIndexes.has(index) &&
      points[points.indexOf(point) + 1] !== local.originalPoints[index + 1]
    ) {
      return false
    }
  }
  for (let index = 0; index < local.terminalPrefixLength; index++) {
    if (points[index] !== local.originalPoints[index]) return false
  }
  for (let offset = 1; offset <= local.terminalSuffixLength; offset++) {
    if (
      points[points.length - offset] !==
      local.originalPoints[local.originalPoints.length - offset]
    ) {
      return false
    }
  }
  return true
}

function* getPadTargetedForceErrors(
  errors: Pipeline9DrcError[],
  onErrorAttempted?: (errorIndex: number) => void,
): Generator<ForceErrorTarget, void, unknown> {
  for (const [errorIndex, error] of errors.entries()) {
    onErrorAttempted?.(errorIndex)
    if (
      error.type === "pcb_pad_trace_clearance_error" &&
      error.__pad_ids !== undefined
    ) {
      const padIds = error.__pad_ids
      const pads = error.__pad_copper
      if (
        !Array.isArray(padIds) ||
        padIds.length === 0 ||
        !Array.isArray(pads) ||
        pads.length !== padIds.length
      ) {
        throw new Error(
          "Pipeline9 pad forces require exact physical pad owners",
        )
      }
      for (const [index, pad] of pads.entries()) {
        if (
          !pad ||
          typeof pad !== "object" ||
          (pad.type === "pcb_smtpad"
            ? pad.pcb_smtpad_id
            : pad.pcb_plated_hole_id) !== padIds[index]
        ) {
          throw new Error("Pipeline9 pad force geometry has a different owner")
        }
        yield { kind: "pad", error, pad }
      }
      continue
    }
    const centers = error.__pad_centers
    if (
      error.type !== "pcb_pad_trace_clearance_error" ||
      centers === undefined
    ) {
      yield { kind: "native", error }
      continue
    }
    if (!Array.isArray(centers) || centers.length === 0) {
      throw new Error("Pipeline9 pad clearance forces require pad centers")
    }
    for (const center of centers) {
      if (
        !center ||
        typeof center !== "object" ||
        typeof center.x !== "number" ||
        typeof center.y !== "number" ||
        !Number.isFinite(center.x) ||
        !Number.isFinite(center.y)
      ) {
        throw new Error("Pipeline9 pad clearance force center is invalid")
      }
      // checkPadTraceClearance reports the whole fragment's endpoint midpoint,
      // which need not be near the offending pad. Target the exact serialized
      // pad for this private force call; official errors and scoring stay intact.
      yield {
        kind: "native",
        error: { ...error, center: { x: center.x, y: center.y } },
      }
    }
  }
}

const getLocalNativeFeedbackErrors = (
  feedback: Pipeline9HighDensityForceFeedback,
  traceRouteIndexById: ReadonlyMap<string, number>,
): Pipeline9DrcError[] | undefined => {
  if (feedback === undefined) return undefined
  const selected: Pipeline9DrcError[] = []
  for (const error of feedback.errors) {
    const padIds = new Set(
      Array.isArray(error.__pad_ids) ? error.__pad_ids : [],
    )
    const participants = [
      ...getPipeline9DrcErrorTraceIds(error),
      ...(Array.isArray(error.__via_owner_trace_ids)
        ? error.__via_owner_trace_ids
        : []),
      error.__trace_segment_owner_trace_id,
    ].filter(
      (identity): identity is string =>
        typeof identity === "string" && !padIds.has(identity),
    )
    if (!participants.some((identity) => traceRouteIndexById.has(identity))) {
      continue
    }
    // Native owner promotion is one flag for the entire call. Only wholly
    // local copper pairs can share the captured false-promotion protocol.
    // External-only errors are guidance-ineligible, not removed from checks.
    if (
      typeof error.pcb_trace_id !== "string" ||
      !traceRouteIndexById.has(error.pcb_trace_id) ||
      participants.some((identity) => !traceRouteIndexById.has(identity))
    ) {
      return undefined
    }
    selected.push(error)
  }
  return selected
}

const getNativeFeedbackForceArguments = (
  feedback: NativeFeedbackState,
  traceRouteIndexById: ReadonlyMap<string, number>,
  obstacles: Obstacle[],
  layerCount: number,
): { errors: Pipeline9DrcError[]; obstacles: Obstacle[] } | undefined => {
  const errors: Pipeline9DrcError[] = []
  let padObstacles: Obstacle[] | undefined
  for (const target of getPadTargetedForceErrors(feedback.errors)) {
    if (target.kind !== "pad") {
      if (
        target.error.type === "pcb_pad_trace_clearance_error" ||
        (Array.isArray(target.error.__pad_ids) &&
          target.error.__pad_ids.length > 0)
      ) {
        return undefined
      }
      errors.push(target.error)
      continue
    }
    const routeIndex = traceRouteIndexById.get(
      target.error.pcb_trace_id as string,
    )!
    const padTarget = getPipeline9PadCopperForceTarget({
      pad: target.pad,
      route: feedback.state.mutableRoutes[routeIndex]!,
      obstacles,
      layerCount,
    })
    if (padTarget === undefined) return undefined
    // One native call has one obstacle context. Different physical pad
    // projections cannot share it without stealing each other's targets.
    if (
      padObstacles !== undefined &&
      (padObstacles.length !== padTarget.obstacles.length ||
        padObstacles.some(
          (obstacle, index) => obstacle !== padTarget.obstacles[index],
        ))
    ) {
      return undefined
    }
    padObstacles = padTarget.obstacles
    errors.push({ ...target.error, center: padTarget.center })
  }
  return { errors, obstacles: padObstacles ?? obstacles }
}

/**
 * Applies Repair03's error-directed geometry operator to one HD node's mutable
 * fragments. The caller evaluates every yielded candidate against the complete
 * current board before publishing it. No global repair solver is instantiated.
 */
export function* getPipeline9HighDensityForceCandidates({
  node,
  hdRoutes,
  errors,
  traceRouteIndexById,
  obstacles,
  layerCount,
  viaDiameter,
  viaHoleDiameter,
  traceWidth,
  obstacleMargin,
  connMap,
  forceContext,
  effort,
  onErrorAttempted,
  onCandidateAttempted,
  onCandidateRejected,
}: Pipeline9HighDensityForceCandidateParams): Generator<
  HighDensityRoute[],
  void,
  Pipeline9HighDensityForceFeedback
> {
  // Match IntraNodeSolver's exact domain, including terminal/leap port points
  // outside the nominal node rectangle. This adds no discretionary margin.
  const nodeBounds = getBoundsFromNodeWithPortPoints(node)
  // HD handoffs sit on node edges. Give the geometry operator room for their
  // copper radius, then enforce the exact node bounds on all candidate points.
  const copperRadius = Math.max(
    viaDiameter / 2,
    traceWidth / 2,
    ...hdRoutes.map((route) =>
      Math.max(route.viaDiameter / 2, route.traceThickness / 2),
    ),
  )
  const srj: SimpleRouteJson & { minViaHoleDiameter: number } = {
    bounds: {
      minX: nodeBounds.minX - copperRadius,
      maxX: nodeBounds.maxX + copperRadius,
      minY: nodeBounds.minY - copperRadius,
      maxY: nodeBounds.maxY + copperRadius,
    },
    connections: [],
    obstacles: forceContext.obstacles,
    layerCount,
    minTraceWidth: traceWidth,
    minViaDiameter: viaDiameter,
    minViaHoleDiameter: viaHoleDiameter,
    minTraceToPadEdgeClearance: obstacleMargin,
    minViaEdgeToPadEdgeClearance: obstacleMargin,
  }
  const throughObstacleSpanStartIndexesByRoute = hdRoutes.map(
    (route): ReadonlySet<number> =>
      getOriginalThroughObstacleSpanStartIndexes(
        route,
        layerCount,
        obstacles,
        connMap,
      ),
  )
  const forceTraceIds = hdRoutes.map((_, routeIndex): string => {
    const traceIds = [...traceRouteIndexById].flatMap(([traceId, index]) =>
      index === routeIndex ? [traceId] : [],
    )
    const traceId = traceIds[0]
    if (
      traceId === undefined ||
      traceIds.some(
        (identity) =>
          identity !== traceId &&
          !forceContext.connMap.areIdsConnected(traceId, identity),
      )
    ) {
      throw new Error(
        "Pipeline9 force routes require consistent PCB trace owners",
      )
    }
    return traceId
  })
  const maxCandidateApplications =
    getMaxTargetedCandidateAttemptsForEffort(effort)
  for (const forceTarget of getPadTargetedForceErrors(
    errors,
    onErrorAttempted,
  )) {
    const { error } = forceTarget
    const participantTraceIds = getPipeline9DrcErrorTraceIds(error)
    const movableTraceId = participantTraceIds.find((traceId) =>
      traceRouteIndexById.has(traceId),
    )
    if (movableTraceId === undefined) continue
    const localError = { ...error, pcb_trace_id: movableTraceId }
    // A trace omitted from the local route map may own either the segment or
    // the via. Only actual via ownership permits the operator's specialized
    // via-owner move; otherwise it must work on the mapped trace segment.
    const viaOwnerTraceIds = error.__via_owner_trace_ids
    const primaryOwnsReportedVia =
      Array.isArray(viaOwnerTraceIds) &&
      viaOwnerTraceIds.includes(movableTraceId)
    const primaryRouteIndex = traceRouteIndexById.get(movableTraceId)!
    const originalPadTarget =
      forceTarget.kind === "pad"
        ? getPipeline9PadCopperForceTarget({
            pad: forceTarget.pad,
            route: hdRoutes[primaryRouteIndex]!,
            obstacles: forceContext.obstacles,
            layerCount,
          })
        : undefined
    const originalProtectedIndexes = new Set(
      [...throughObstacleSpanStartIndexesByRoute[primaryRouteIndex]!].flatMap(
        (index) => [index, index + 1],
      ),
    )
    const originalPadMobility =
      originalPadTarget !== undefined && originalPadTarget.distance > 0
        ? getPipeline9PadTraceForceMobility({
            route: hdRoutes[primaryRouteIndex]!,
            target: originalPadTarget,
            protectedPointIndexes: originalProtectedIndexes,
          })
        : undefined
    const canApplyPadWireForce =
      originalPadMobility !== undefined && originalPadMobility.contactWeight > 0
    const canApplyOneEndpointPadForce =
      canApplyPadWireForce && originalPadMobility!.pointIndexes.length === 2
    if (
      canApplyPadWireForce &&
      (typeof error.minimum_clearance !== "number" ||
        !Number.isFinite(error.minimum_clearance) ||
        error.minimum_clearance < 0)
    ) {
      throw new Error(
        "Pipeline9 pad-wire target requires an official clearance",
      )
    }
    const families: Pipeline9HighDensityForceFamily[] = canApplyPadWireForce
      ? ["pad-wire", "native"]
      : ["native"]
    const canApplyTracePairForce =
      forceTarget.kind === "native" &&
      error.type === "pcb_trace_error" &&
      error.pcb_via_id === undefined &&
      !(Array.isArray(error.pcb_via_ids) && error.pcb_via_ids.length > 0) &&
      !(Array.isArray(viaOwnerTraceIds) && viaOwnerTraceIds.length > 0) &&
      !(Array.isArray(error.__pad_ids) && error.__pad_ids.length > 0) &&
      participantTraceIds.length === 2 &&
      participantTraceIds.every((traceId) =>
        traceRouteIndexById.has(traceId),
      ) &&
      getTraceRoutePairForError(localError, traceRouteIndexById) !== undefined
    const forcePasses = getForceScalesForEffort(effort).map(
      (scale, scaleIndex): ForcePass => ({
        scaleIndex,
        scale,
        applicationStart: canApplyTracePairForce && scaleIndex === 1 ? 2 : 0,
        applicationEnd: maxCandidateApplications,
      }),
    )
    if (canApplyTracePairForce) {
      const oneSidedPass = forcePasses[1]
      if (oneSidedPass === undefined || maxCandidateApplications < 2) {
        throw new Error(
          "Pipeline9 trace-pair forces require two existing slots",
        )
      }
      // First-improvement acceptance discards the remaining private search.
      // Visit the two existing one-sided slots before graded native nudges,
      // retaining every native scale, application and cumulative chain order.
      forcePasses.unshift({
        ...oneSidedPass,
        applicationStart: 0,
        applicationEnd: 2,
      })
    }
    if (canApplyOneEndpointPadForce) {
      const firstPadPass = forcePasses[0]
      const duplicatePadPass = forcePasses[2]
      if (
        firstPadPass === undefined ||
        duplicatePadPass === undefined ||
        maxCandidateApplications < 3 ||
        Math.abs(firstPadPass.scale) !== Math.abs(duplicatePadPass.scale)
      ) {
        throw new Error(
          "Pipeline9 endpoint pad forces require two duplicate rigid slots",
        )
      }
      // The pad helper uses only abs(scale): its complete -1 rigid chain is
      // identical to +1. Spend two duplicate slots on independent endpoints,
      // after the distinct rigid scales. A first-accepted endpoint rotation
      // can leave a broad pad violation that rigid translation clears fully.
      // Keep the original slots so it cannot preempt those rigid candidates.
    }
    const statesByScaleIndex = new Map<
      number,
      Map<Pipeline9HighDensityForceFamily, ForceFamilyState>
    >()
    const canSeedNativeFeedback =
      forceTarget.kind === "pad" &&
      error.type === "pcb_pad_trace_clearance_error"
    let nativeFeedback: NativeFeedbackState | undefined
    for (const pass of forcePasses) {
      const { scaleIndex, scale } = pass
      let states = statesByScaleIndex.get(scaleIndex)
      if (states === undefined) {
        states = new Map()
        statesByScaleIndex.set(scaleIndex, states)
      }
      // Official accidental-contact errors have no graded overlap severity.
      // A bounded private force sequence can cross that plateau before any
      // candidate is accepted; never restart it from a published partial move.
      // Eligible pad-wire/native families alternate within this SAME budget,
      // each with independent cumulative geometry. Ineligible contact targets
      // retain native-only search; exhausted slots are never reassigned.
      for (
        let application = pass.applicationStart;
        application < pass.applicationEnd;
        application++
      ) {
        // These are the original slot identities, even in the prefixed pass.
        // Endpoint families remain independent. Sharing each original scale's
        // state across descriptors preserves split native cumulative chains.
        const ordinaryFamily: Pipeline9HighDensityForceFamily =
          canApplyTracePairForce && scaleIndex === 1 && application < 2
            ? application === 0
              ? "trace-pair-0"
              : "trace-pair-1"
            : canApplyOneEndpointPadForce &&
                scaleIndex === 2 &&
                (application === 0 || application === 2)
              ? application === 0
                ? "pad-wire-0"
                : "pad-wire-1"
              : families[application % families.length]!
        if (
          ordinaryFamily === "native" &&
          scaleIndex === 2 &&
          nativeFeedback?.state.exhausted
        ) {
          continue
        }
        const feedbackArguments =
          ordinaryFamily === "native" &&
          scaleIndex === 2 &&
          nativeFeedback !== undefined
            ? getNativeFeedbackForceArguments(
                nativeFeedback,
                traceRouteIndexById,
                forceContext.obstacles,
                layerCount,
              )
            : undefined
        const family =
          feedbackArguments === undefined ? ordinaryFamily : "native-feedback"
        let state =
          family === "native-feedback"
            ? nativeFeedback!.state
            : states.get(family)
        if (state === undefined) {
          const localRoutes = hdRoutes.map(
            (route, index): LocalForceRoute =>
              createLocalForceRoute(
                route,
                throughObstacleSpanStartIndexesByRoute[index]!,
              ),
          )
          const mutableRoutes = localRoutes.map((local) => local.mutable)
          for (const [index, route] of mutableRoutes.entries()) {
            // Routing aliases can merge pads that the official serialized board
            // treats as foreign. Only private force geometry uses PCB owners.
            route.connectionName = forceTraceIds[index]!
            route.rootConnectionName = forceTraceIds[index]!
          }
          state = { family, localRoutes, mutableRoutes, exhausted: false }
          states.set(family, state)
        }
        if (state.exhausted) continue
        const { localRoutes, mutableRoutes } = state
        onCandidateAttempted?.(state.family, scale, application)
        const padTarget =
          forceTarget.kind === "pad" && state.family !== "native-feedback"
            ? getPipeline9PadCopperForceTarget({
                pad: forceTarget.pad,
                route: mutableRoutes[primaryRouteIndex]!,
                obstacles: forceContext.obstacles,
                layerCount,
              })
            : undefined
        if (
          forceTarget.kind === "pad" &&
          state.family !== "native-feedback" &&
          padTarget === undefined
        ) {
          onCandidateRejected?.("no-motion")
          state.exhausted = true
          continue
        }
        let changed: boolean
        if (state.family === "native-feedback") {
          // Original typed physical-pad +1/-1 native chains are identical:
          // their obstacle and via moves use abs(scale). Reuse only those
          // duplicate -1 slots; new error types always receive source scale +1.
          changed = applyDrcErrorForces(
            { ...srj, obstacles: feedbackArguments!.obstacles },
            mutableRoutes,
            feedbackArguments!.errors,
            traceRouteIndexById,
            1,
            forceContext.connMap,
            true,
            false,
            false,
            false,
          )
        } else if (
          state.family === "pad-wire" ||
          state.family === "pad-wire-0" ||
          state.family === "pad-wire-1"
        ) {
          const protectedPointIndexes = new Set(
            localRoutes[primaryRouteIndex]!.protectedPointIndexes,
          )
          if (state.family !== "pad-wire") {
            protectedPointIndexes.add(
              padTarget!.segmentIndex + (state.family === "pad-wire-0" ? 1 : 0),
            )
          }
          changed = applyPipeline9PadTraceForce({
            route: mutableRoutes[primaryRouteIndex]!,
            target: padTarget!,
            protectedPointIndexes,
            minimumClearance: error.minimum_clearance as number,
            scale,
          })
        } else if (
          state.family === "trace-pair-0" ||
          state.family === "trace-pair-1"
        ) {
          changed =
            applyTracePairSegmentDisplacementForError(
              srj,
              mutableRoutes,
              localError,
              traceRouteIndexById,
              state.family === "trace-pair-0" ? 0 : 1,
            ) !== undefined
        } else {
          changed = applyDrcErrorForces(
            padTarget ? { ...srj, obstacles: padTarget.obstacles } : srj,
            mutableRoutes,
            [
              padTarget
                ? { ...localError, center: padTarget.center }
                : localError,
            ],
            traceRouteIndexById,
            scale,
            forceContext.connMap,
            true,
            false,
            false,
            primaryOwnsReportedVia,
          )
        }
        if (!changed) {
          onCandidateRejected?.("no-motion")
          state.exhausted = true
          continue
        }
        if (
          localRoutes.some((local) => !hasPreservedLocalRouteAnchors(local))
        ) {
          onCandidateRejected?.("anchor")
          state.exhausted = true
          continue
        }
        for (const local of localRoutes) {
          // The force operator copies the starting point for detours. New
          // waypoints inherit width, not terminal or through-obstacle identity.
          local.mutable.route = local.mutable.route.map((point) => {
            if (local.originalPointByMutablePoint.has(point)) return point
            const {
              pcb_port_id,
              insideJumperPad,
              toNextSegmentType,
              toNextSegmentCircuitJsonMetadata,
              ...waypoint
            } = point
            return waypoint
          })
        }
        // Native materialization re-derives every via from transition points.
        // An untouched neighbour can instead retain its published rounded via
        // metadata. Require exact ordered provenance as well as coordinates;
        // inserted or replaced points still take the normal derivation path.
        const hasUnchangedGeometry = localRoutes.map(
          (local): boolean =>
            local.mutable.route.length === local.original.route.length &&
            local.mutable.route.every((point, index): boolean => {
              const originalPoint = local.original.route[index]!
              return (
                local.originalPointByMutablePoint.get(point) ===
                  originalPoint &&
                Object.is(point.x, originalPoint.x) &&
                Object.is(point.y, originalPoint.y) &&
                Object.is(point.z, originalPoint.z)
              )
            }),
        )
        const candidates = materializeRoutesForIndexes(
          mutableRoutes,
          hasUnchangedGeometry.flatMap((unchanged, index): number[] =>
            unchanged ? [] : [index],
          ),
        )
        if (
          !candidates.every((candidate, index) =>
            isPipeline9HighDensityRouteInsideBounds(
              candidate,
              nodeBounds,
              layerCount,
              { originalRoute: hdRoutes[index]!, node },
            ),
          )
        ) {
          onCandidateRejected?.("geometry")
          state.exhausted = true
          continue
        }
        // Keep temporary pad-span tags through validation and via derivation:
        // an implicit coincident pad transition must not become a drilled via.
        // Detach every published point before the next private force step.
        const feedback = yield candidates.map(
          (candidate, index): HighDensityRoute => {
            const local = localRoutes[index]!
            return {
              ...hdRoutes[index]!,
              vias: (hasUnchangedGeometry[index]
                ? local.original.vias
                : candidate.vias
              ).map((via) => ({ ...via })),
              route: candidate.route.map((point): HighDensityPoint => {
                const originalPoint =
                  local.originalPointByMutablePoint.get(point)
                return originalPoint
                  ? { ...originalPoint, x: point.x, y: point.y, z: point.z }
                  : { ...point }
              }),
            }
          },
        )
        if (
          (canSeedNativeFeedback &&
            state.family === "native" &&
            scaleIndex === 0) ||
          state.family === "native-feedback"
        ) {
          const feedbackErrors = getLocalNativeFeedbackErrors(
            feedback,
            traceRouteIndexById,
          )
          if (feedbackErrors === undefined) {
            if (feedback !== undefined || state.family === "native-feedback") {
              nativeFeedback = undefined
            }
          } else {
            // Clone immediately after this exact yield resumes. Later +1
            // trials can mutate and fail, so their live state is not a checkpoint.
            const checkpoint = structuredClone(localRoutes)
            nativeFeedback = {
              state: {
                family: "native-feedback",
                localRoutes: checkpoint,
                mutableRoutes: checkpoint.map((local) => local.mutable),
                exhausted: false,
              },
              errors: structuredClone(feedbackErrors),
            }
          }
        }
      }
    }
  }
}
