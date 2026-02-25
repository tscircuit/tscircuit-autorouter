import {
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "lib/types/capacity-mesh-types"
import { ExploredPortPoint } from "./types"
import { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"

type Input = {
  target: CapacityMeshNode
  mapOfCapacityMeshNodeIdToSegmentPortPoints: Map<
    CapacityMeshNodeId,
    SegmentPortPoint[]
  >
  mapOfCapacityMeshNodeIdToRef: Map<CapacityMeshNodeId, CapacityMeshNode>
  depthLimit: number
  shouldIgnoreCrampedPortPoints: boolean
}

export const getCandidatesAtDepthUsingBfs = (params: Input) => {
  const resultCandidates = []
  const bestCandidateForPort = new Map<
    ExploredPortPoint["port"],
    ExploredPortPoint
  >()
  const {
    target,
    depthLimit,
    mapOfCapacityMeshNodeIdToSegmentPortPoints,
    mapOfCapacityMeshNodeIdToRef,
    shouldIgnoreCrampedPortPoints,
  } = params
  if (depthLimit < 1) {
    throw new Error("Depth limit must be at least 1")
  }

  const queue: ExploredPortPoint[] =
    mapOfCapacityMeshNodeIdToSegmentPortPoints
      .get(target.capacityMeshNodeId)!
      .filter((e) => !shouldIgnoreCrampedPortPoints || !e.cramped)
      .map((spp) => {
        const initialCandidate = {
          port: spp,
          depth: 1,
          parent: null,
          countOfCrampedPortPointsInPath: spp.cramped ? 1 : 0,
        }
        bestCandidateForPort.set(spp, initialCandidate)
        return initialCandidate
      })

  while (queue.length > 0) {
    const currentCandidate = queue.shift()!
    const { port, depth } = currentCandidate

    if (depth === depthLimit) {
      resultCandidates.push(currentCandidate)
      continue
    }

    const nextNodes = port.nodeIds.map((nodeId) => {
      const cmNode = mapOfCapacityMeshNodeIdToRef.get(nodeId)
      if (!cmNode) {
        throw new Error(`Could not find capacity mesh node for id ${nodeId}`)
      }
      return cmNode
    })

    const nextPorts = nextNodes.flatMap(
      (node) =>
        mapOfCapacityMeshNodeIdToSegmentPortPoints.get(
          node.capacityMeshNodeId,
        )!,
    )

    for (const nextPort of nextPorts) {
      if (shouldIgnoreCrampedPortPoints && nextPort.cramped) {
        continue
      }
      const nextCandidate: ExploredPortPoint = {
        port: nextPort,
        depth: depth + 1,
        parent: currentCandidate,
        countOfCrampedPortPointsInPath:
          currentCandidate.countOfCrampedPortPointsInPath +
          (nextPort.cramped ? 1 : 0),
      }
      const existingCandidate = bestCandidateForPort.get(nextPort)

      if (existingCandidate && existingCandidate.depth < nextCandidate.depth) {
        continue
      }
      if (
        existingCandidate &&
        existingCandidate.depth === nextCandidate.depth &&
        existingCandidate.countOfCrampedPortPointsInPath <=
          nextCandidate.countOfCrampedPortPointsInPath
      ) {
        continue
      }

      bestCandidateForPort.set(nextPort, nextCandidate)
      queue.push(nextCandidate)
    }
  }

  return resultCandidates
}
