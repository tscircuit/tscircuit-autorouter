import { CapacityMeshNodeId, CapacityMeshNode } from "lib/types"
import { ExploredPortPoint } from "./types"

type Input = {
  candidates: ExploredPortPoint[]
  mapOfCapacityMeshNodeIdToRef: Map<CapacityMeshNodeId, CapacityMeshNode>
}

export const isAllCandidatesBlockedByObstacles = (params: Input): boolean => {
  const { candidates, mapOfCapacityMeshNodeIdToRef } = params
  let allCandidatesBlocked = true
  for (const candidate of candidates) {
    let isCurrentCandidateBlocked = false
    const port = candidate.port
    port.nodeIds.forEach((nodeId) => {
      const cmNode = mapOfCapacityMeshNodeIdToRef.get(nodeId)
      if (!cmNode) {
        throw new Error(`Could not find capacity mesh node for id ${nodeId}`)
      }
      if (cmNode._containsObstacle) {
        isCurrentCandidateBlocked = true
      }
    })
    if (!isCurrentCandidateBlocked) {
      allCandidatesBlocked = false
    }
  }
  return allCandidatesBlocked
}
