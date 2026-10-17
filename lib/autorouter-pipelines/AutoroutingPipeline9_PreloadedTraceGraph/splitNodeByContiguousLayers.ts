import type { NodeWithPortPoints } from "lib/types/high-density-types"

/** Independent clear layer blocks cannot be bridged by a physical via. */
export const splitNodeByContiguousLayers = (
  node: NodeWithPortPoints,
): NodeWithPortPoints[] => {
  if (node.isLayerTransition || !node.availableZ || node.availableZ.length < 2) {
    return [node]
  }
  const groups: number[][] = []
  for (const z of [...node.availableZ].sort((a, b) => a - b)) {
    const previous = groups.at(-1)
    if (previous && previous.at(-1)! + 1 === z) previous.push(z)
    else groups.push([z])
  }
  if (groups.length === 1) return [node]
  for (const [start, end] of node.portPointsInPairs ?? []) {
    if (
      !groups.some((group) => group.includes(start.z) && group.includes(end.z))
    ) {
      throw new Error(
        `Node "${node.capacityMeshNodeId}" requires a via through a blocked layer`,
      )
    }
  }
  return groups.flatMap((availableZ): NodeWithPortPoints[] => {
    const portPoints = node.portPoints.filter((point) =>
      availableZ.includes(point.z),
    )
    if (portPoints.length === 0) return []
    return [
      {
        ...node,
        availableZ,
        portPoints,
        portPointsInPairs: node.portPointsInPairs?.filter(([start]) =>
          availableZ.includes(start.z),
        ),
      },
    ]
  })
}
