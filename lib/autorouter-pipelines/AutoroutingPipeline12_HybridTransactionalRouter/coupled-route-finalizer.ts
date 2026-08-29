import { findCoupledRouteConstraintViolation } from "./coupled-route-constraints"
import { TransactionalCopperStore } from "./transactional-copper-store"
import type {
  HybridCopperPoint,
  HybridCopperSegment,
  HybridCopperSnapshot,
  HybridTransactionDelta,
  TransactionRejection,
} from "./transactional-copper-types"
import type { TypedRoutingProblem } from "./types"

const GEOMETRY_EPSILON = 1e-9

export type CoupledRouteFinalizationRecord = {
  readonly delta: HybridTransactionDelta
  readonly committedSnapshot: HybridCopperSnapshot
}

export type CoupledRouteFinalizationResult =
  | {
      readonly status: "finalized"
      readonly records: readonly CoupledRouteFinalizationRecord[]
    }
  | {
      readonly status: "failed"
      readonly message: string
      readonly rejection?: TransactionRejection
      readonly records: readonly CoupledRouteFinalizationRecord[]
    }

type MergeableSegment = {
  readonly segment: HybridCopperSegment
  readonly sourceCopperIds: readonly string[]
}

export function finalizeCoupledRoutes({
  problem,
  copperStore,
}: {
  problem: TypedRoutingProblem
  copperStore: TransactionalCopperStore
}): CoupledRouteFinalizationResult {
  const allConnectionNames = new Set(
    problem.compiledRules.connections.map(
      (connection) => connection.connectionName,
    ),
  )
  const initialViolation = findCoupledRouteConstraintViolation({
    compiledRules: problem.compiledRules,
    copperSnapshot: copperStore.getSnapshot(),
    affectedConnectionNames: allConnectionNames,
  })
  if (initialViolation) {
    return Object.freeze({
      status: "failed" as const,
      message: initialViolation.message,
      records: Object.freeze([]),
    })
  }
  const records: CoupledRouteFinalizationRecord[] = []
  for (const routeObject of problem.routeObjects) {
    if (routeObject.kind === "preloaded_copper") continue
    const snapshot = copperStore.getSnapshot()
    const ownedSegments = snapshot.segments.filter(
      (segment) =>
        segment.ownership.mutability === "mutable" &&
        segment.ownership.ownerRouteObjectIds.length === 1 &&
        segment.ownership.ownerRouteObjectIds[0] === routeObject.routeObjectId,
    )
    const finalizedSegments = simplifyAndResolveWidths({
      segments: ownedSegments,
      snapshot,
    })
    const removedCopperIds = new Set(
      finalizedSegments.flatMap((entry) =>
        entry.sourceCopperIds.length > 1 ||
        entry.segment.widthMm !==
          getCompiledWidth({
            problem,
            connectionName: entry.segment.connectionName,
          })
          ? entry.sourceCopperIds
          : [],
      ),
    )
    const addedTraces = finalizedSegments.flatMap((entry) => {
      const compiledWidthMm = getCompiledWidth({
        problem,
        connectionName: entry.segment.connectionName,
      })
      const changed =
        entry.sourceCopperIds.length > 1 ||
        entry.segment.widthMm !== compiledWidthMm
      return changed
        ? [
            Object.freeze({
              ...entry.segment,
              copperId: buildFinalizedCopperId({
                ownerRouteObjectId: routeObject.routeObjectId,
                connectionName: entry.segment.connectionName,
                sourceCopperIds: entry.sourceCopperIds,
              }),
              widthMm: compiledWidthMm,
            }),
          ]
        : []
    })
    if (removedCopperIds.size === 0 && addedTraces.length === 0) continue
    const connectionNames = Object.freeze([
      ...new Set(addedTraces.map((segment) => segment.connectionName)),
    ])
    const delta: HybridTransactionDelta = Object.freeze({
      transactionId: `finalize:${routeObject.routeObjectId}:${snapshot.version}`,
      regionId: `finalization:${routeObject.routeObjectId}`,
      ownerRouteObjectId: routeObject.routeObjectId,
      baseCopperVersion: snapshot.version,
      boundaryContractVersion: copperStore.getBoundaryContractVersion(),
      addedTraces: Object.freeze(addedTraces),
      removedOwnedTraceIds: Object.freeze([...removedCopperIds].sort()),
      addedVias: Object.freeze([]),
      removedOwnedViaIds: Object.freeze([]),
      connectivityEffects: Object.freeze({
        connectionNames,
        connectedTerminalIds: Object.freeze([]),
      }),
      affectedBounds: problem.compiledRules.boardBounds,
      candidateCost: Object.freeze({
        viaCount: 0,
        totalLengthMm: addedTraces.reduce(
          (total, segment) => total + getSegmentLength(segment),
          0,
        ),
        bendCount: 0,
        congestionCost: 0,
        softViaBudgetExceeded: false,
      }),
      work: Object.freeze({
        searchExpansions: 0,
        spatialIndexQueries: 0,
        drcPredicateCalls: 0,
        geometryAllocations: addedTraces.length,
        candidatesConstructed: 1,
        candidatesStepped: 1,
        activeRings: 0,
        solverStateRebuilds: 0,
      }),
      diagnostic: Object.freeze({
        code: "coupled_route_finalization",
        message:
          "trace simplification and final compiled widths were proposed as a transaction",
        regionIds: Object.freeze([`finalization:${routeObject.routeObjectId}`]),
        connectionNames,
      }),
    })
    const commit = copperStore.commit(delta)
    if (commit.status !== "committed") {
      return Object.freeze({
        status: "failed" as const,
        message: commit.rejection.message,
        rejection: commit.rejection,
        records: Object.freeze(records),
      })
    }
    records.push(
      Object.freeze({ delta, committedSnapshot: commit.snapshot }),
    )
  }
  const finalViolation = findCoupledRouteConstraintViolation({
    compiledRules: problem.compiledRules,
    copperSnapshot: copperStore.getSnapshot(),
    affectedConnectionNames: allConnectionNames,
  })
  return finalViolation
    ? Object.freeze({
        status: "failed" as const,
        message: finalViolation.message,
        records: Object.freeze(records),
      })
    : Object.freeze({
        status: "finalized" as const,
        records: Object.freeze(records),
      })
}

function simplifyAndResolveWidths({
  segments,
  snapshot,
}: {
  segments: readonly HybridCopperSegment[]
  snapshot: HybridCopperSnapshot
}): readonly MergeableSegment[] {
  const mergeable = segments.map((segment) => ({
    segment,
    sourceCopperIds: Object.freeze([segment.copperId]),
  }))
  let changed = true
  while (changed) {
    changed = false
    outer: for (let firstIndex = 0; firstIndex < mergeable.length; firstIndex++) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < mergeable.length;
        secondIndex++
      ) {
        const merged = tryMergeSegments({
          first: mergeable[firstIndex]!,
          second: mergeable[secondIndex]!,
          allSegments: snapshot.segments,
          allVias: snapshot.vias,
        })
        if (!merged) continue
        mergeable.splice(secondIndex, 1)
        mergeable.splice(firstIndex, 1, merged)
        changed = true
        break outer
      }
    }
  }
  return Object.freeze(mergeable)
}

function tryMergeSegments({
  first,
  second,
  allSegments,
  allVias,
}: {
  first: MergeableSegment
  second: MergeableSegment
  allSegments: readonly HybridCopperSegment[]
  allVias: HybridCopperSnapshot["vias"]
}): MergeableSegment | undefined {
  if (
    first.segment.connectionName !== second.segment.connectionName ||
    first.segment.layer !== second.segment.layer ||
    first.segment.widthMm !== second.segment.widthMm
  ) {
    return undefined
  }
  const sharedPoint = findSharedEndpoint(first.segment, second.segment)
  if (!sharedPoint) return undefined
  const firstOther = getOtherEndpoint(first.segment, sharedPoint)
  const secondOther = getOtherEndpoint(second.segment, sharedPoint)
  const firstDirection = {
    x: firstOther.x - sharedPoint.x,
    y: firstOther.y - sharedPoint.y,
  }
  const secondDirection = {
    x: secondOther.x - sharedPoint.x,
    y: secondOther.y - sharedPoint.y,
  }
  if (Math.abs(orientation(firstOther, sharedPoint, secondOther)) > GEOMETRY_EPSILON) {
    return undefined
  }
  if (
    samePoint(firstOther, secondOther) ||
    firstDirection.x * secondDirection.x +
      firstDirection.y * secondDirection.y >=
      -GEOMETRY_EPSILON
  ) {
    return undefined
  }
  const sourceIds = new Set([
    ...first.sourceCopperIds,
    ...second.sourceCopperIds,
  ])
  const incidentForeignSegment = allSegments.some(
    (segment) =>
      !sourceIds.has(segment.copperId) &&
      segment.connectionName === first.segment.connectionName &&
      (samePoint(segment.start, sharedPoint) ||
        samePoint(segment.end, sharedPoint)),
  )
  const incidentVia = allVias.some(
    (via) =>
      via.connectionName === first.segment.connectionName &&
      samePoint(via, sharedPoint),
  )
  if (incidentForeignSegment || incidentVia) return undefined
  return Object.freeze({
    segment: Object.freeze({
      ...first.segment,
      start: Object.freeze({ ...firstOther }),
      end: Object.freeze({ ...secondOther }),
    }),
    sourceCopperIds: Object.freeze([...sourceIds].sort()),
  })
}

function findSharedEndpoint(
  first: HybridCopperSegment,
  second: HybridCopperSegment,
): HybridCopperPoint | undefined {
  return [first.start, first.end].find((firstPoint) =>
    [second.start, second.end].some((secondPoint) =>
      samePoint(firstPoint, secondPoint),
    ),
  )
}

function getOtherEndpoint(
  segment: HybridCopperSegment,
  endpoint: HybridCopperPoint,
): HybridCopperPoint {
  return samePoint(segment.start, endpoint) ? segment.end : segment.start
}

function getCompiledWidth({
  problem,
  connectionName,
}: {
  problem: TypedRoutingProblem
  connectionName: string
}): number {
  const connection = problem.compiledRules.connections.find(
    (candidate) => candidate.connectionName === connectionName,
  )
  if (!connection) throw new Error(`unknown connection ${connectionName}`)
  return connection.traceWidthMm
}

function buildFinalizedCopperId({
  ownerRouteObjectId,
  connectionName,
  sourceCopperIds,
}: {
  ownerRouteObjectId: string
  connectionName: string
  sourceCopperIds: readonly string[]
}): string {
  return `finalized:${ownerRouteObjectId}:${connectionName}:${stableStringHash(
    [...sourceCopperIds].sort().join("\u0000"),
  ).toString(16)}`
}

function stableStringHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function getSegmentLength(segment: HybridCopperSegment): number {
  return Math.hypot(
    segment.end.x - segment.start.x,
    segment.end.y - segment.start.y,
  )
}

function orientation(
  first: HybridCopperPoint,
  second: HybridCopperPoint,
  third: HybridCopperPoint,
): number {
  return (
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  )
}

function samePoint(
  first: HybridCopperPoint,
  second: HybridCopperPoint,
): boolean {
  return first.x === second.x && first.y === second.y
}
