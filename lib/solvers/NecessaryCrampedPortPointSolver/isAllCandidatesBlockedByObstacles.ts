import { IsAllCandidatesBlockedByObstaclesInput } from "./types"

export const isAllCandidatesBlockedByObstacles = (
  params: IsAllCandidatesBlockedByObstaclesInput,
): boolean => {
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
