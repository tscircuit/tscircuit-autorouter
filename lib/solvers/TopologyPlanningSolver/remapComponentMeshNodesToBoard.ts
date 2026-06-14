import type { ComponentKind } from "lib/solvers/ComponentDetectionSolver/detectors/types"
import type { CapacityMeshNode } from "lib/types"

function remapBgaNodeAvailableZToBoard({
  node,
}: {
  node: CapacityMeshNode
}) {
  return [...node.availableZ]
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
    })

    return {
      ...node,
      availableZ,
      layer: `z${availableZ.join(",")}`,
    }
  })
}
