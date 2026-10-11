import { MinHeap } from "tiny-hypergraph/lib/MinHeap"
import type { ParallelGoalBallWorkerJob, ParallelGoalBallWorkerResult,
  TinyGoalBallBounds, TinyGoalBallGraph, TinyGoalBallGroup } from "./parallelGoalBallWorkerTypes"

/**
 * Distance-aware routing scores and queues the final goal segment through its
 * onPathFound override. Reverse search uses the symmetric geometric metric,
 * then restores the directed endpoint penalty. Clipping every unknown
 * distance to the next fresh queue key retains a consistent absolute bound;
 * replacing unknown distances with zero would break that property.
 */
export function computeTinyGoalBallBounds(
  graph: TinyGoalBallGraph, group: TinyGoalBallGroup, maximumSettledPorts: number,
): TinyGoalBallBounds {
  const portCount = graph.portOffsets.length - 1
  if (!Number.isInteger(maximumSettledPorts) || maximumSettledPorts < 1 ||
      graph.targets.length !== graph.costs.length || graph.targets.length !== graph.edgeRegionIds.length ||
      graph.halfPenalties.length !== portCount || group.usablePorts.length !== portCount ||
      graph.portOffsets[0] !== 0 || graph.portOffsets[portCount] !== graph.targets.length) {
    throw new Error("Goal-ball graph or search capacity is inconsistent")
  }
  if (!Number.isInteger(group.netId) || !Number.isInteger(group.targetPortId) ||
      group.targetPortId < 0 || group.targetPortId >= portCount || !group.usablePorts[group.targetPortId]) {
    throw new Error("Goal-ball target or net is invalid")
  }
  const remainingStarts = new Set(group.startPortIds)
  for (const start of remainingStarts) {
    if (!Number.isInteger(start) || start < 0 || start >= portCount || !group.usablePorts[start]) {
      throw new Error("Goal-ball start is outside its usable graph")
    }
  }
  if (remainingStarts.size === 0) throw new Error("Goal-ball search requires a start port")
  const distances = new Float64Array(portCount).fill(Number.POSITIVE_INFINITY)
  const queue = new MinHeap<{ portId: number; cost: number }>([], (left, right) => left.cost - right.cost)
  distances[group.targetPortId] = 0
  queue.queue({ portId: group.targetPortId, cost: 0 })
  let expandedPortCount = 0
  let relaxationCount = 0
  let cutoff = Number.POSITIVE_INFINITY
  while (queue.length > 0) {
    const candidate = queue.dequeue()!
    if (candidate.cost !== distances[candidate.portId]) continue
    if (expandedPortCount >= maximumSettledPorts || remainingStarts.size === 0) {
      cutoff = candidate.cost
      break
    }
    expandedPortCount++
    remainingStarts.delete(candidate.portId)
    const begin = graph.portOffsets[candidate.portId]!
    const end = graph.portOffsets[candidate.portId + 1]!
    if (begin < 0 || end < begin || end > graph.targets.length) throw new Error("Goal-ball CSR row is invalid")
    for (let edge = begin; edge < end; edge++) {
      relaxationCount++
      const target = graph.targets[edge]!
      const regionNet = graph.regionNetIds[graph.edgeRegionIds[edge]!]!
      const edgeCost = graph.costs[edge]!
      if (!Number.isInteger(target) || target < 0 || target >= portCount || regionNet === undefined ||
          !Number.isFinite(edgeCost) || edgeCost < 0) throw new Error("Goal-ball graph has an invalid edge")
      if (!group.usablePorts[target] || (regionNet !== -1 && regionNet !== group.netId)) continue
      const cost = candidate.cost + edgeCost
      if (cost >= distances[target]!) continue
      distances[target] = cost
      queue.queue({ portId: target, cost })
    }
  }
  const bounds = Float64Array.from(distances, (distance, portId): number => {
    const penalty = graph.halfPenalties[portId]!
    if (!Number.isFinite(penalty) || penalty < 0) throw new Error("Goal-ball endpoint potential is invalid")
    return Math.max(0, Math.min(distance, cutoff) + graph.halfPenalties[group.targetPortId]! - penalty)
  })
  return { netId: group.netId, targetPortId: group.targetPortId, bounds, cutoff,
    expandedPortCount, relaxationCount }
}

export function executeParallelGoalBallJob(job: ParallelGoalBallWorkerJob): ParallelGoalBallWorkerResult {
  return { kind: "pathingGoalBalls", groups: job.groups.map((group): TinyGoalBallBounds =>
    computeTinyGoalBallBounds(job.graph, group, job.maximumSettledPorts)) }
}
