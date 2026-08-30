import { buildWorkerCoreSearchRequest } from "./build-worker-core-request"
import { runMultiResolutionSearch } from "./multi-resolution-router"
import type {
  HybridCoreRoutePoint,
  HybridRoutingCoreRuntime,
} from "./rust-core-protocol"
import type {
  HybridCopperOwnership,
  HybridCopperSegment,
  HybridCopperVia,
  HybridTransactionDelta,
} from "./transactional-copper-types"
import type {
  HybridWorkerBoardContext,
  HybridWorkerConnectionRule,
  RegionJob,
  RegionJobCoupling,
  RegionSearchSpec,
} from "./worker-protocol"

const GEOMETRY_EPSILON = 1e-9

type ParallelCoupling = Extract<
  RegionJobCoupling,
  { kind: "differential_pair" | "bus" }
>

export type CoupledParallelExecutionResult =
  | {
      readonly status: "candidate"
      readonly transactionDelta: HybridTransactionDelta
    }
  | {
      readonly status: "failed"
      readonly code: "unknown_rule_reference" | "core_search_failed"
      readonly message: string
    }

type CoupledMember = {
  readonly search: RegionSearchSpec
  readonly rule: HybridWorkerConnectionRule
  readonly centerOffsetMm: number
}

export async function executeCoupledParallelJob({
  context,
  job,
  runtime,
}: {
  context: HybridWorkerBoardContext
  job: RegionJob & { readonly coupling: ParallelCoupling }
  runtime: HybridRoutingCoreRuntime
}): Promise<CoupledParallelExecutionResult> {
  const membersResult = buildCoupledMembers({ context, job })
  if (membersResult.status === "failed") return membersResult
  const members = membersResult.members
  const routingLayer = selectCoupledRoutingLayer({ context, job, members })
  if (!routingLayer) {
    return {
      status: "failed",
      code: "core_search_failed",
      message: `${job.jobId} has no common layer with legal terminal transitions for every coupled member`,
    }
  }
  const start = averagePoints(members.map((member) => member.search.start))
  const goal = averagePoints(members.map((member) => member.search.goal))
  if (samePoint(start, goal)) {
    return {
      status: "failed",
      code: "core_search_failed",
      message: `${job.jobId} has coincident coupled spine terminals`,
    }
  }
  const spineDirection = { x: goal.x - start.x, y: goal.y - start.y }
  if (
    members.some((member) => {
      const memberDirection = {
        x: member.search.goal.x - member.search.start.x,
        y: member.search.goal.y - member.search.start.y,
      }
      return dot(spineDirection, memberDirection) <= 0
    })
  ) {
    return {
      status: "failed",
      code: "core_search_failed",
      message: `${job.jobId} has inconsistent coupled terminal direction`,
    }
  }
  const envelopeWidthMm =
    members[members.length - 1]!.centerOffsetMm -
    members[0]!.centerOffsetMm +
    members[0]!.rule.traceWidthMm / 2 +
    members[members.length - 1]!.rule.traceWidthMm / 2
  const searchResult = await runMultiResolutionSearch({
    runtime,
    baseRequest: buildWorkerCoreSearchRequest({
      context,
      job,
      searchIdentity: `coupled:${job.coupling.kind}`,
      start: Object.freeze({ ...start, layer: routingLayer }),
      goal: Object.freeze({ ...goal, layer: routingLayer }),
      allowedLayers: Object.freeze([routingLayer]),
      traceWidthMm: envelopeWidthMm,
      maximumVias: 0,
      connectedConnectionNames: Object.freeze([
        ...new Set(
          members.flatMap(
            (member) => member.rule.electricallyConnectedConnectionNames,
          ),
        ),
      ]),
    }),
    maximumActivationRings: job.solverBudget.maximumActivationRings,
  })
  if (searchResult.status === "failed") {
    return {
      status: "failed",
      code: "core_search_failed",
      message: `${job.jobId}: ${searchResult.response.code}: ${searchResult.response.message}`,
    }
  }
  if (
    searchResult.response.vias.length > 0 ||
    searchResult.response.route.some((point) => point.layer !== routingLayer)
  ) {
    return {
      status: "failed",
      code: "core_search_failed",
      message: `${job.jobId} returned an unsupported layer-changing coupled spine`,
    }
  }
  const trimmedSpine = trimEndpointHooks(
    removeConsecutiveDuplicatePoints(searchResult.response.route),
  )
  const fanoutDistanceMm =
    job.coupling.kind === "bus"
      ? Math.max(envelopeWidthMm * 2, job.routingResolutionMm * 4)
      : Math.max(
          job.routingResolutionMm * 2,
          Math.min(
            envelopeWidthMm,
            job.coupling.maximumUncoupledLengthMm / 4,
          ),
        )
  const spine = clipPolylineEnds({
    points: trimmedSpine,
    distanceMm: fanoutDistanceMm,
  })
  if (spine.length < 2) {
    return {
      status: "failed",
      code: "core_search_failed",
      message: `${job.jobId} returned an empty coupled spine`,
    }
  }
  const firstNormal = getLeftNormal(start, goal)
  const terminalOrderVector = {
    x:
      members[members.length - 1]!.search.start.x -
      members[0]!.search.start.x,
    y:
      members[members.length - 1]!.search.start.y -
      members[0]!.search.start.y,
  }
  const orientationSign = dot(firstNormal, terminalOrderVector) >= 0 ? 1 : -1
  const untunedPaths = members.map((member) => {
    const offsetSpine = offsetPolyline({
      points: spine,
      offsetMm: member.centerOffsetMm * orientationSign,
    })
    return removeConsecutiveDuplicatePoints([
      Object.freeze({ ...member.search.start, layer: routingLayer }),
      ...offsetSpine,
      Object.freeze({ ...member.search.goal, layer: routingLayer }),
    ])
  })
  const targetLengthMm = Math.max(...untunedPaths.map(getPathLength))
  const memberPaths =
    job.coupling.kind === "bus"
      ? untunedPaths.map((path, memberIndex) =>
          addLengthTuningDetour({
            path,
            additionalLengthMm: targetLengthMm - getPathLength(path),
            memberOffsetMm:
              members[memberIndex]!.centerOffsetMm * orientationSign,
          }),
        )
      : untunedPaths
  const ownership = createOwnership(job.ownerRouteObjectId)
  const addedTraces = members.flatMap((member, memberIndex) => {
    const completePath = memberPaths[memberIndex]!
    return completePath.flatMap((point, pointIndex): HybridCopperSegment[] => {
      const nextPoint = completePath[pointIndex + 1]
      if (!nextPoint) return []
      return [
        Object.freeze({
          kind: "segment" as const,
          copperId: `${job.transactionId}:member:${memberIndex}:segment:${pointIndex}`,
          connectionName: member.rule.connectionName,
          layer: routingLayer,
          start: Object.freeze({ x: point.x, y: point.y }),
          end: Object.freeze({ x: nextPoint.x, y: nextPoint.y }),
          widthMm: member.rule.traceWidthMm,
          ownership,
        }),
      ]
    })
  })
  const addedVias = members.flatMap((member, memberIndex) =>
    createTerminalTransitionVias({
      context,
      job,
      member,
      memberIndex,
      routingLayer,
      ownership,
    }),
  )
  const softViaBudgetExceeded = members.some((member) => {
    const addedViaCount = addedVias.filter(
      (via) => via.connectionName === member.rule.connectionName,
    ).length
    return addedViaCount > member.rule.viaSoftMaximum
  })
  const totalLengthMm = addedTraces.reduce(
    (total, segment) =>
      total +
      Math.hypot(
        segment.end.x - segment.start.x,
        segment.end.y - segment.start.y,
      ),
    0,
  )
  return {
    status: "candidate",
    transactionDelta: Object.freeze({
      transactionId: job.transactionId,
      regionId: job.regionId,
      ownerRouteObjectId: job.ownerRouteObjectId,
      baseCopperVersion: job.copperVersion,
      boundaryContractVersion: job.boundaryContractVersion,
      addedTraces: Object.freeze(addedTraces),
      removedOwnedTraceIds: Object.freeze([]),
      addedVias: Object.freeze(addedVias),
      removedOwnedViaIds: Object.freeze([]),
      connectivityEffects: Object.freeze({
        connectionNames: job.coupling.orderedConnectionNames,
        connectedTerminalIds: Object.freeze([...job.terminalReferences]),
      }),
      affectedBounds: job.envelope,
      candidateCost: Object.freeze({
        viaCount: addedVias.length,
        totalLengthMm,
        bendCount: memberPaths.reduce(
          (total, path) => total + countPathBends(path),
          0,
        ),
        congestionCost: job.congestionCost,
        softViaBudgetExceeded,
        softViaBudgetJustification: softViaBudgetExceeded
          ? "the least-obstructed common coupled layer requires paired terminal transitions"
          : undefined,
      }),
      work: Object.freeze({
        searchExpansions: searchResult.metrics.work.searchExpansions,
        spatialIndexQueries: searchResult.metrics.work.spatialIndexQueries,
        drcPredicateCalls: searchResult.metrics.work.geometryPredicateCalls,
        geometryAllocations: addedTraces.length + addedVias.length,
        candidatesConstructed: searchResult.metrics.candidatesConstructed,
        candidatesStepped: searchResult.metrics.candidatesStepped,
        activeRings: searchResult.metrics.activeRings,
        solverStateRebuilds: searchResult.metrics.solverStateRebuilds,
      }),
      diagnostic: Object.freeze({
        code: "coupled_worker_region_candidate",
        message: `worker generated one ${job.coupling.kind} envelope candidate`,
        regionIds: Object.freeze([job.regionId]),
        connectionNames: job.coupling.orderedConnectionNames,
      }),
    }),
  }
}

function selectCoupledRoutingLayer({
  context,
  job,
  members,
}: {
  context: HybridWorkerBoardContext
  job: RegionJob & { readonly coupling: ParallelCoupling }
  members: readonly CoupledMember[]
}): string | undefined {
  const commonLayers = context.layerNames.filter((layer) =>
    members.every(
      (member) =>
        member.rule.allowedLayers.includes(layer) &&
        terminalCanReachLayer({
          context,
          terminalLayer: member.search.start.layer,
          routingLayer: layer,
          remainingViaBudget: member.search.remainingViaBudget,
        }) &&
        terminalCanReachLayer({
          context,
          terminalLayer: member.search.goal.layer,
          routingLayer: layer,
          remainingViaBudget: member.search.remainingViaBudget,
        }),
    ),
  )
  const pairTerminalLayer = members[0]!.search.start.layer
  if (job.coupling.kind === "differential_pair") {
    return members.every(
      (member) =>
        member.search.start.layer === pairTerminalLayer &&
        member.search.goal.layer === pairTerminalLayer &&
        member.rule.allowedLayers.includes(pairTerminalLayer),
    )
      ? pairTerminalLayer
      : undefined
  }
  return [...commonLayers].sort(
    (first, second) =>
      getLayerPressure({ context, job, layer: first }) -
        getLayerPressure({ context, job, layer: second }) ||
      context.layerNames.indexOf(first) - context.layerNames.indexOf(second) ||
      first.localeCompare(second),
  )[0]
}

function terminalCanReachLayer({
  context,
  terminalLayer,
  routingLayer,
  remainingViaBudget,
}: {
  context: HybridWorkerBoardContext
  terminalLayer: string
  routingLayer: string
  remainingViaBudget: number
}): boolean {
  if (terminalLayer === routingLayer) return true
  return (
    remainingViaBudget >= 2 &&
    context.legalViaSpans.some(
      (span) =>
        (span.fromLayer === terminalLayer && span.toLayer === routingLayer) ||
        (span.fromLayer === routingLayer && span.toLayer === terminalLayer),
    )
  )
}

function getLayerPressure({
  context,
  job,
  layer,
}: {
  context: HybridWorkerBoardContext
  job: RegionJob & { readonly coupling: ParallelCoupling }
  layer: string
}): number {
  return context.geometry.filter(
    (item) =>
      item.geometry.layer === layer &&
      !item.connectedConnectionNames.some((connectionName) =>
        job.coupling.orderedConnectionNames.includes(connectionName),
      ),
  ).length
}

function createTerminalTransitionVias({
  context,
  job,
  member,
  memberIndex,
  routingLayer,
  ownership,
}: {
  context: HybridWorkerBoardContext
  job: RegionJob & { readonly coupling: ParallelCoupling }
  member: CoupledMember
  memberIndex: number
  routingLayer: string
  ownership: HybridCopperOwnership
}): readonly HybridCopperVia[] {
  return Object.freeze(
    [member.search.start, member.search.goal].flatMap(
      (terminal, terminalIndex): HybridCopperVia[] =>
        terminal.layer === routingLayer
          ? []
          : [
              Object.freeze({
                kind: "via" as const,
                copperId: `${job.transactionId}:member:${memberIndex}:terminal-via:${terminalIndex}`,
                connectionName: member.rule.connectionName,
                x: terminal.x,
                y: terminal.y,
                fromLayer: terminal.layer,
                toLayer: routingLayer,
                padDiameterMm: context.viaPadDiameterMm,
                holeDiameterMm: context.viaHoleDiameterMm,
                ownership,
              }),
            ],
    ),
  )
}

function clipPolylineEnds({
  points,
  distanceMm,
}: {
  points: readonly HybridCoreRoutePoint[]
  distanceMm: number
}): readonly HybridCoreRoutePoint[] {
  const totalLength = getPathLength(points)
  if (points.length < 2 || totalLength <= 2 * distanceMm) return points
  const start = getPointAtPathDistance({ points, distanceMm })
  const end = getPointAtPathDistance({
    points,
    distanceMm: totalLength - distanceMm,
  })
  const cumulativeLengths = getCumulativePathLengths(points)
  const middlePoints = points.filter(
    (_, pointIndex) =>
      cumulativeLengths[pointIndex]! > distanceMm + GEOMETRY_EPSILON &&
      cumulativeLengths[pointIndex]! <
        totalLength - distanceMm - GEOMETRY_EPSILON,
  )
  return removeConsecutiveDuplicatePoints([start, ...middlePoints, end])
}

function getPointAtPathDistance({
  points,
  distanceMm,
}: {
  points: readonly HybridCoreRoutePoint[]
  distanceMm: number
}): HybridCoreRoutePoint {
  const cumulativeLengths = getCumulativePathLengths(points)
  const edgeIndex = cumulativeLengths.findIndex(
    (length, pointIndex) =>
      pointIndex > 0 && length >= distanceMm - GEOMETRY_EPSILON,
  )
  if (edgeIndex <= 0) return points[0]!
  const start = points[edgeIndex - 1]!
  const end = points[edgeIndex]!
  const edgeStartDistance = cumulativeLengths[edgeIndex - 1]!
  const edgeLength = cumulativeLengths[edgeIndex]! - edgeStartDistance
  const ratio = Math.max(
    0,
    Math.min(1, (distanceMm - edgeStartDistance) / edgeLength),
  )
  return Object.freeze({
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
    layer: start.layer,
  })
}

function getCumulativePathLengths(
  points: readonly HybridCoreRoutePoint[],
): readonly number[] {
  const cumulativeLengths = [0]
  for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
    const previous = points[pointIndex - 1]!
    const point = points[pointIndex]!
    cumulativeLengths.push(
      cumulativeLengths[pointIndex - 1]! +
        Math.hypot(point.x - previous.x, point.y - previous.y),
    )
  }
  return cumulativeLengths
}

function trimEndpointHooks(
  points: readonly HybridCoreRoutePoint[],
): readonly HybridCoreRoutePoint[] {
  if (points.length < 3) return points
  const overallDirection = {
    x: points[points.length - 1]!.x - points[0]!.x,
    y: points[points.length - 1]!.y - points[0]!.y,
  }
  const firstForwardEdgeIndex = points.findIndex((point, pointIndex) => {
    const next = points[pointIndex + 1]
    return (
      next !== undefined &&
      dot(
        { x: next.x - point.x, y: next.y - point.y },
        overallDirection,
      ) > GEOMETRY_EPSILON
    )
  })
  let lastForwardEdgeIndex = -1
  for (let pointIndex = points.length - 2; pointIndex >= 0; pointIndex--) {
    const point = points[pointIndex]!
    const next = points[pointIndex + 1]!
    if (
      dot(
        { x: next.x - point.x, y: next.y - point.y },
        overallDirection,
      ) > GEOMETRY_EPSILON
    ) {
      lastForwardEdgeIndex = pointIndex
      break
    }
  }
  if (
    firstForwardEdgeIndex < 0 ||
    lastForwardEdgeIndex < firstForwardEdgeIndex
  ) {
    return points
  }
  return Object.freeze(
    points.slice(firstForwardEdgeIndex, lastForwardEdgeIndex + 2),
  )
}

function addLengthTuningDetour({
  path,
  additionalLengthMm,
  memberOffsetMm,
}: {
  path: readonly HybridCoreRoutePoint[]
  additionalLengthMm: number
  memberOffsetMm: number
}): readonly HybridCoreRoutePoint[] {
  if (additionalLengthMm <= GEOMETRY_EPSILON || path.length < 2) return path
  let longestEdgeIndex = 0
  let longestEdgeLength = 0
  for (let edgeIndex = 0; edgeIndex < path.length - 1; edgeIndex++) {
    const edgeStart = path[edgeIndex]!
    const edgeEnd = path[edgeIndex + 1]!
    const edgeLength = Math.hypot(
      edgeEnd.x - edgeStart.x,
      edgeEnd.y - edgeStart.y,
    )
    if (edgeLength > longestEdgeLength) {
      longestEdgeLength = edgeLength
      longestEdgeIndex = edgeIndex
    }
  }
  const start = path[longestEdgeIndex]!
  const end = path[longestEdgeIndex + 1]!
  const dx = end.x - start.x
  const dy = end.y - start.y
  const directLength = Math.hypot(dx, dy)
  if (directLength <= GEOMETRY_EPSILON) return path
  const unit = { x: dx / directLength, y: dy / directLength }
  const perpendicularDistance = additionalLengthMm / 2
  const windowLengthMm = Math.min(
    directLength / 3,
    Math.max(0.25, additionalLengthMm / 4),
  )
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const perpendicular = { x: -dy / directLength, y: dx / directLength }
  const outwardSign = memberOffsetMm < 0 ? -1 : 1
  const windowStart = {
    x: midpoint.x - unit.x * windowLengthMm / 2,
    y: midpoint.y - unit.y * windowLengthMm / 2,
    layer: start.layer,
  }
  const windowEnd = {
    x: midpoint.x + unit.x * windowLengthMm / 2,
    y: midpoint.y + unit.y * windowLengthMm / 2,
    layer: start.layer,
  }
  const displacedStart = {
    x:
      windowStart.x +
      perpendicular.x * perpendicularDistance * outwardSign,
    y:
      windowStart.y +
      perpendicular.y * perpendicularDistance * outwardSign,
    layer: start.layer,
  }
  const displacedEnd = {
    x:
      windowEnd.x + perpendicular.x * perpendicularDistance * outwardSign,
    y:
      windowEnd.y + perpendicular.y * perpendicularDistance * outwardSign,
    layer: start.layer,
  }
  return Object.freeze([
    ...path.slice(0, longestEdgeIndex + 1),
    Object.freeze(windowStart),
    Object.freeze(displacedStart),
    Object.freeze(displacedEnd),
    Object.freeze(windowEnd),
    ...path.slice(longestEdgeIndex + 1),
  ])
}

function getPathLength(points: readonly HybridCoreRoutePoint[]): number {
  return points.slice(0, -1).reduce((total, point, pointIndex) => {
    const next = points[pointIndex + 1]!
    return total + Math.hypot(next.x - point.x, next.y - point.y)
  }, 0)
}

function countPathBends(points: readonly HybridCoreRoutePoint[]): number {
  return points.slice(0, -2).filter((point, pointIndex) => {
    const second = points[pointIndex + 1]!
    const third = points[pointIndex + 2]!
    return (
      Math.abs(
        cross(
          { x: second.x - point.x, y: second.y - point.y },
          { x: third.x - second.x, y: third.y - second.y },
        ),
      ) > GEOMETRY_EPSILON
    )
  }).length
}

function buildCoupledMembers({
  context,
  job,
}:
  {
    context: HybridWorkerBoardContext
    job: RegionJob & { readonly coupling: ParallelCoupling }
  }):
  | { readonly status: "members"; readonly members: readonly CoupledMember[] }
  | Extract<CoupledParallelExecutionResult, { status: "failed" }> {
  const orderedSearches = job.coupling.orderedConnectionNames.map(
    (connectionName) =>
      job.searches.filter(
        (search) => search.connectionRuleReference === connectionName,
      ),
  )
  if (orderedSearches.some((searches) => searches.length !== 1)) {
    return {
      status: "failed",
      code: "core_search_failed",
      message: `${job.jobId} requires exactly one corridor per coupled member`,
    }
  }
  const rules = job.coupling.orderedConnectionNames.map((connectionName) =>
    context.connectionRules.find(
      (candidate) => candidate.connectionName === connectionName,
    ),
  )
  if (rules.some((rule) => !rule)) {
    return {
      status: "failed",
      code: "unknown_rule_reference",
      message: `${job.jobId} references an unknown coupled connection rule`,
    }
  }
  const centerOffsets = [0]
  for (let memberIndex = 1; memberIndex < rules.length; memberIndex++) {
    centerOffsets.push(
      centerOffsets[memberIndex - 1]! +
        rules[memberIndex - 1]!.traceWidthMm / 2 +
        job.coupling.adjacentEdgeGapsMm[memberIndex - 1]! +
        rules[memberIndex]!.traceWidthMm / 2,
    )
  }
  const envelopeCenter =
    (centerOffsets[0]! + centerOffsets[centerOffsets.length - 1]!) / 2
  return {
    status: "members",
    members: Object.freeze(
      rules.map((rule, memberIndex) =>
        Object.freeze({
          search: orderedSearches[memberIndex]![0]!,
          rule: rule!,
          centerOffsetMm: centerOffsets[memberIndex]! - envelopeCenter,
        }),
      ),
    ),
  }
}

function offsetPolyline({
  points,
  offsetMm,
}: {
  points: readonly HybridCoreRoutePoint[]
  offsetMm: number
}): readonly HybridCoreRoutePoint[] {
  return Object.freeze(
    points.map((point, pointIndex) => {
      if (pointIndex === 0) {
        const normal = getLeftNormal(point, points[1]!)
        return Object.freeze({
          x: point.x + normal.x * offsetMm,
          y: point.y + normal.y * offsetMm,
          layer: point.layer,
        })
      }
      if (pointIndex === points.length - 1) {
        const normal = getLeftNormal(points[pointIndex - 1]!, point)
        return Object.freeze({
          x: point.x + normal.x * offsetMm,
          y: point.y + normal.y * offsetMm,
          layer: point.layer,
        })
      }
      const previous = points[pointIndex - 1]!
      const next = points[pointIndex + 1]!
      const incomingNormal = getLeftNormal(previous, point)
      const outgoingNormal = getLeftNormal(point, next)
      const incomingPoint = {
        x: point.x + incomingNormal.x * offsetMm,
        y: point.y + incomingNormal.y * offsetMm,
      }
      const outgoingPoint = {
        x: point.x + outgoingNormal.x * offsetMm,
        y: point.y + outgoingNormal.y * offsetMm,
      }
      const intersection = intersectInfiniteLines({
        firstPoint: incomingPoint,
        firstDirection: { x: point.x - previous.x, y: point.y - previous.y },
        secondPoint: outgoingPoint,
        secondDirection: { x: next.x - point.x, y: next.y - point.y },
      })
      return Object.freeze({
        ...(intersection ?? {
          x: point.x + ((incomingNormal.x + outgoingNormal.x) / 2) * offsetMm,
          y: point.y + ((incomingNormal.y + outgoingNormal.y) / 2) * offsetMm,
        }),
        layer: point.layer,
      })
    }),
  )
}

function intersectInfiniteLines({
  firstPoint,
  firstDirection,
  secondPoint,
  secondDirection,
}: {
  firstPoint: { readonly x: number; readonly y: number }
  firstDirection: { readonly x: number; readonly y: number }
  secondPoint: { readonly x: number; readonly y: number }
  secondDirection: { readonly x: number; readonly y: number }
}): { readonly x: number; readonly y: number } | undefined {
  const denominator = cross(firstDirection, secondDirection)
  if (Math.abs(denominator) <= 1e-12) return undefined
  const delta = {
    x: secondPoint.x - firstPoint.x,
    y: secondPoint.y - firstPoint.y,
  }
  const scale = cross(delta, secondDirection) / denominator
  return {
    x: firstPoint.x + firstDirection.x * scale,
    y: firstPoint.y + firstDirection.y * scale,
  }
}

function getLeftNormal(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length <= 1e-12) throw new Error("coupled spine contains a zero-length edge")
  return { x: -dy / length, y: dx / length }
}

function removeConsecutiveDuplicatePoints(
  points: readonly HybridCoreRoutePoint[],
): readonly HybridCoreRoutePoint[] {
  return Object.freeze(
    points.filter(
      (point, pointIndex) =>
        pointIndex === 0 || !samePoint(point, points[pointIndex - 1]!),
    ),
  )
}

function averagePoints(
  points: readonly HybridCoreRoutePoint[],
): { readonly x: number; readonly y: number } {
  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  }
}

function samePoint(
  first: { readonly x: number; readonly y: number },
  second: { readonly x: number; readonly y: number },
): boolean {
  return first.x === second.x && first.y === second.y
}

function dot(
  first: { readonly x: number; readonly y: number },
  second: { readonly x: number; readonly y: number },
): number {
  return first.x * second.x + first.y * second.y
}

function cross(
  first: { readonly x: number; readonly y: number },
  second: { readonly x: number; readonly y: number },
): number {
  return first.x * second.y - first.y * second.x
}

function createOwnership(ownerRouteObjectId: string): HybridCopperOwnership {
  return Object.freeze({
    mutability: "mutable",
    ownerRouteObjectIds: Object.freeze([ownerRouteObjectId]),
  })
}
