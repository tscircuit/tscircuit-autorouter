import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "high-density-repair03/lib"
import { getForceScalesForEffort } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import {
  applyDrcErrorForces,
  materializeRoutes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import {
  getPipeline9DrcErrorTraceIds,
  type Pipeline9DrcError,
} from "./pipeline9JointDrcRepairUtils"

type HighDensityPoint = HighDensityRoute["route"][number]

type LocalForceRoute = {
  original: HighDensityRoute
  mutable: HighDensityRoute
  originalPoints: HighDensityPoint[]
  protectedPointIndexes: Set<number>
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
  effort: number
  onCandidateRejected?: (
    reason: Pipeline9HighDensityForceRejectionReason,
  ) => void
}

const createLocalForceRoute = (original: HighDensityRoute): LocalForceRoute => {
  const originalPoints = original.route.map((point) => ({ ...point }))
  const first = originalPoints[0]
  const last = originalPoints.at(-1)
  if (!first || !last) {
    throw new Error("Pipeline9 local DRC forces require nonempty routes")
  }
  // Earlier HD stages keep terminal identity on the route rather than on its
  // points. The force operator needs the real identity on each temporary end
  // point so it searches interior moves instead of moving a connected pad end.
  if (first.pcb_port_id === undefined && original.startPcbPortId !== undefined) {
    first.pcb_port_id = original.startPcbPortId
  }
  if (last.pcb_port_id === undefined && original.endPcbPortId !== undefined) {
    last.pcb_port_id = original.endPcbPortId
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
    protectedPointIndexes,
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
      originalPoint.toNextSegmentType === "through_obstacle" &&
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

const hasValidLocalRouteGeometry = (
  route: HighDensityRoute,
  bounds: SimpleRouteJson["bounds"],
  layerCount: number,
): boolean => {
  for (let index = 0; index < route.route.length; index++) {
    const point = route.route[index]!
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isInteger(point.z) ||
      point.z < 0 ||
      point.z >= layerCount ||
      point.x < bounds.minX ||
      point.x > bounds.maxX ||
      point.y < bounds.minY ||
      point.y > bounds.maxY
    ) {
      return false
    }
    const next = route.route[index + 1]
    if (
      next &&
      point.z !== next.z &&
      point.toNextSegmentType !== "through_obstacle" &&
      (point.x !== next.x || point.y !== next.y)
    ) {
      return false
    }
  }
  return true
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
  effort,
  onCandidateRejected,
}: Pipeline9HighDensityForceCandidateParams): Generator<
  HighDensityRoute[],
  void,
  unknown
> {
  const nodeBounds = {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }
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
    obstacles,
    layerCount,
    minTraceWidth: traceWidth,
    minViaDiameter: viaDiameter,
    minViaHoleDiameter: viaHoleDiameter,
    minTraceToPadEdgeClearance: obstacleMargin,
    minViaEdgeToPadEdgeClearance: obstacleMargin,
  }
  for (const error of errors) {
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
      const localRoutes = hdRoutes.map(createLocalForceRoute)
      const mutableRoutes = localRoutes.map((local) => local.mutable)
      if (
        !applyDrcErrorForces(
          srj,
          mutableRoutes,
          [localError],
          traceRouteIndexById,
          scale,
          connMap,
          true,
          false,
          false,
          primaryOwnsReportedVia,
        )
      ) {
        onCandidateRejected?.("no-motion")
        continue
      }
      if (localRoutes.some((local) => !hasPreservedLocalRouteAnchors(local))) {
        onCandidateRejected?.("anchor")
        continue
      }
      for (const local of localRoutes) {
        const originalPointByMutablePoint = new Map(
          local.originalPoints.map((point, index) => [
            point,
            local.original.route[index]!,
          ]),
        )
        // The force operator builds detours by copying the starting point. An
        // inserted waypoint inherits segment width, but is not a PCB terminal
        // or a jumper/through-obstacle anchor.
        local.mutable.route = local.mutable.route.map((point) => {
          const originalPoint = originalPointByMutablePoint.get(point)
          if (originalPoint) {
            return {
              ...originalPoint,
              x: point.x,
              y: point.y,
              z: point.z,
            }
          }
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
      const candidates = materializeRoutes(
        localRoutes.map((local) => local.mutable),
      ).map(
        (candidate, index): HighDensityRoute => ({
          ...hdRoutes[index]!,
          route: candidate.route,
          vias: candidate.vias,
        }),
      )
      if (
        candidates.every((candidate) =>
          hasValidLocalRouteGeometry(candidate, nodeBounds, layerCount),
        )
      ) {
        yield candidates
      } else {
        onCandidateRejected?.("geometry")
      }
    }
  }
}
