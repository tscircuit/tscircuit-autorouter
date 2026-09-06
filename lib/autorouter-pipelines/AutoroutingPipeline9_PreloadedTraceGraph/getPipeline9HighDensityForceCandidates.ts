import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "high-density-repair03/lib"
import {
  getForceScalesForEffort,
  getMaxTargetedCandidateAttemptsForEffort,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import {
  applyDrcErrorForces,
  materializeRoutes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import type { Pipeline9HighDensityForceContext } from "./getPipeline9HighDensityForceObstacles"
import { isPipeline9HighDensityRouteInsideBounds } from "./isPipeline9HighDensityRouteInsideBounds"
import {
  getPipeline9DrcErrorTraceIds,
  type Pipeline9DrcError,
} from "./pipeline9JointDrcRepairUtils"

type HighDensityPoint = HighDensityRoute["route"][number]

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

const getPadTargetedForceErrors = (
  errors: Pipeline9DrcError[],
): Pipeline9DrcError[] => {
  return errors.flatMap((error): Pipeline9DrcError[] => {
    const centers = error.__pad_centers
    if (
      error.type !== "pcb_pad_trace_clearance_error" ||
      centers === undefined
    ) {
      return [error]
    }
    if (!Array.isArray(centers) || centers.length === 0) {
      throw new Error("Pipeline9 pad clearance forces require pad centers")
    }
    return centers.map((center): Pipeline9DrcError => {
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
      return { ...error, center: { x: center.x, y: center.y } }
    })
  })
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
  onCandidateRejected,
}: Pipeline9HighDensityForceCandidateParams): Generator<
  HighDensityRoute[],
  void,
  unknown
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
  for (const error of getPadTargetedForceErrors(errors)) {
    const movableTraceId = getPipeline9DrcErrorTraceIds(error).find((traceId) =>
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
    for (const scale of getForceScalesForEffort(effort)) {
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
        // treats as foreign. Only the private force geometry uses PCB owners.
        route.connectionName = forceTraceIds[index]!
        route.rootConnectionName = forceTraceIds[index]!
      }
      // Official accidental-contact errors have no graded overlap severity.
      // A bounded private force sequence can cross that plateau before any
      // candidate is accepted; never restart it from a published partial move.
      for (
        let application = 0;
        application < maxCandidateApplications;
        application++
      ) {
        if (
          !applyDrcErrorForces(
            srj,
            mutableRoutes,
            [localError],
            traceRouteIndexById,
            scale,
            forceContext.connMap,
            true,
            false,
            false,
            primaryOwnsReportedVia,
          )
        ) {
          onCandidateRejected?.("no-motion")
          break
        }
        if (
          localRoutes.some((local) => !hasPreservedLocalRouteAnchors(local))
        ) {
          onCandidateRejected?.("anchor")
          break
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
        const candidates = materializeRoutes(mutableRoutes)
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
          break
        }
        // Keep temporary pad-span tags through validation and via derivation:
        // an implicit coincident pad transition must not become a drilled via.
        // Detach every published point before the next private force step.
        yield candidates.map((candidate, index): HighDensityRoute => {
          const local = localRoutes[index]!
          return {
            ...hdRoutes[index]!,
            vias: candidate.vias.map((via) => ({ ...via })),
            route: candidate.route.map((point): HighDensityPoint => {
              const originalPoint = local.originalPointByMutablePoint.get(point)
              return originalPoint
                ? { ...originalPoint, x: point.x, y: point.y, z: point.z }
                : { ...point }
            }),
          }
        })
      }
    }
  }
}
