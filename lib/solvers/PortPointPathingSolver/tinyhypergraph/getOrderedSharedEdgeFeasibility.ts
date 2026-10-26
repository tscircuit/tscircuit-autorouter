import type { TinyHyperGraphRegionSegmentFeasibilityResult } from "tiny-hypergraph/lib/core"
import {
  getOrderedSharedEdgeSchedule,
  type OrderedSharedEdgePort,
} from "lib/solvers/UniformPortDistributionSolver/getOrderedSharedEdgeSchedule"

export type OrderedSharedEdgeEvent = OrderedSharedEdgePort & {
  portId: number
  serializedPortId: string
  position: number
  routeIds: number[]
  candidate: boolean
  preservedAlone?: boolean
}

type Input = {
  length: number
  events: OrderedSharedEdgeEvent[]
  minimumWidth: number
  traceClearance: number
  proofSlack: number
}

/** Attribute an ordered-placement conflict to complete removable port events. */
export function getOrderedSharedEdgeFeasibility({
  length,
  events,
  minimumWidth,
  traceClearance,
  proofSlack,
}: Input): TinyHyperGraphRegionSegmentFeasibilityResult {
  const ordered = [...events].sort((first, second) =>
    first.position - second.position ||
    first.serializedPortId.localeCompare(second.serializedPortId),
  )
  const rules = {
    length,
    traceClearance,
    tolerance: 0.005,
    minimumProofWidth: minimumWidth,
    proofSlack,
  }
  const isFeasible = (ports: OrderedSharedEdgeEvent[]): boolean => {
    if (ports.length === 1 && ports[0]!.preservedAlone)
      return true
    return getOrderedSharedEdgeSchedule({
      ...rules,
      ports,
    }).feasible
  }
  if (isFeasible(ordered))
    return { feasible: true }
  let core = ordered
  for (let index = 0; index < core.length;) {
    if (core[index]!.candidate) {
      index++
      continue
    }
    const without = core.filter((_, other) => other !== index)
    if (!isFeasible(without))
      core = without
    else index++
  }
  const alternatives = new Map<string, number[]>()
  for (const event of core) {
    if (event.candidate) continue
    if (event.routeIds.length === 0)
      throw new Error("A removable shared-edge event has no committed routes")
    const routes = [...new Set(event.routeIds)].sort((first, second) => first - second)
    alternatives.set(JSON.stringify(routes), routes)
  }
  return alternatives.size === 0
    ? { feasible: false, blockerRouteIds: [] }
    : {
        feasible: false,
        alternativeBlockerRouteIdSets: [...alternatives.values()],
      }
}
