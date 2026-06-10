import type { ComponentKind } from "lib/solvers/ComponentDetectionSolver/detectors/types"
import type { CapacityMeshNode } from "lib/types"

function remapBgaNodeAvailableZToBoard({
  node,
  boardLayerCount,
}: {
  node: CapacityMeshNode
  boardLayerCount: number
}) {
  if (boardLayerCount <= 2) return [...node.availableZ]

  if (node.availableZ.length > 1) {
    return Array.from({ length: boardLayerCount }, (_, z) => z)
  }

  return node.availableZ.map((z) => (z <= 0 ? 0 : boardLayerCount - 1))
}

export function remapComponentMeshNodesToBoard({
  componentKind,
  componentMeshNodes,
  boardLayerCount,
}: {
  componentKind: ComponentKind
  componentMeshNodes: CapacityMeshNode[]
  boardLayerCount: number
}) {
  if (componentKind !== "bga") return componentMeshNodes

  return componentMeshNodes.map((node) => {
    const availableZ = remapBgaNodeAvailableZToBoard({
      node,
      boardLayerCount,
    })

    return {
      ...node,
      availableZ,
      layer: `z${availableZ.join(",")}`,
    }
  })
}
