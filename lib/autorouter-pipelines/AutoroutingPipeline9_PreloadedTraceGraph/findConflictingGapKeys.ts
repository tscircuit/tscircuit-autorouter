import { distance, midpoint, type Point } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { RbushIndex } from "lib/data-structures/RbushIndex"
import type { NetId, SimpleRouteJson } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"

export type PortPointId = NonNullable<PortPoint["portPointId"]>
export type ClearanceGapKey = string
export type ClearanceGap = {
  key: ClearanceGapKey
  start: Point
  end: Point
}

type GapCrossing = { gap: ClearanceGap; netId: NetId; z: number }

const DISTANCE_TOLERANCE = 1e-6

// The four endpoint pairs give the maximum possible distance between crossings.
function getMaximumGapDistance(
  first: ClearanceGap,
  second: ClearanceGap,
): number {
  return Math.max(
    distance(first.start, second.start),
    distance(first.start, second.end),
    distance(first.end, second.start),
    distance(first.end, second.end),
  )
}

/**
 * Keep crossings in plan order. Exclude a later gap only if no pair of
 * positions can clear the earlier net on the same layer.
 */
export function findConflictingGapKeys({
  nodesWithPortPoints,
  clearanceGapsByPortId,
  connMap,
  srj,
}: {
  nodesWithPortPoints: ReadonlyArray<Pick<NodeWithPortPoints, "portPoints">>
  clearanceGapsByPortId: ReadonlyMap<PortPointId, ClearanceGap>
  connMap: ConnectivityMap
  srj: Pick<
    SimpleRouteJson,
    "minTraceWidth" | "minTraceToPadEdgeClearance" | "defaultObstacleMargin"
  >
}): Set<ClearanceGapKey> {
  const conflictingGapKeys = new Set<ClearanceGapKey>()
  if (clearanceGapsByPortId.size < 2) return conflictingGapKeys
  const traceClearance =
    srj.minTraceToPadEdgeClearance ??
    srj.defaultObstacleMargin ??
    RELAXED_DRC_OPTIONS.traceClearance
  const minCenterDistance = srj.minTraceWidth + traceClearance
  const keptCrossings = new RbushIndex<GapCrossing>()
  const visitedPortIds = new Set<PortPointId>()

  for (const { portPoints } of nodesWithPortPoints) {
    for (const portPoint of portPoints) {
      const { portPointId, z } = portPoint
      // Adjacent mesh nodes report the same boundary crossing.
      if (!portPointId || visitedPortIds.has(portPointId)) continue
      const gap = clearanceGapsByPortId.get(portPointId)
      if (!gap) continue
      visitedPortIds.add(portPointId)

      const connectionName =
        portPoint.rootConnectionName ?? portPoint.connectionName
      const netId =
        connMap.getNetConnectedToId(connectionName) ?? connectionName
      const { x, y } = midpoint(gap.start, gap.end)
      const neighbors = keptCrossings.search(
        x - minCenterDistance,
        y - minCenterDistance,
        x + minCenterDistance,
        y + minCenterDistance,
      )
      const conflicts = neighbors.some(
        (crossing) =>
          crossing.z === z &&
          crossing.netId !== netId &&
          !conflictingGapKeys.has(crossing.gap.key) &&
          getMaximumGapDistance(gap, crossing.gap) <
            minCenterDistance - DISTANCE_TOLERANCE,
      )
      if (conflicts) {
        conflictingGapKeys.add(gap.key)
      } else {
        keptCrossings.insert({ gap, netId, z }, x, y, x, y)
      }
    }
  }
  return conflictingGapKeys
}
