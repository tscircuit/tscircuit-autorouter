import type { CapacityMeshNode } from "lib/types"
import { createTopologyValidationInput } from "./createTopologyValidationInput"

export function createDisjointTopologyValidationInput(
  count: number,
  trackGeometryReads = true,
): { input: ReturnType<typeof createTopologyValidationInput>; geometryReads: { count: number } } {
  const columns = Math.ceil(Math.sqrt(count))
  const nodes: CapacityMeshNode[] = Array.from({ length: count }, (_, index) => ({
    capacityMeshNodeId: `disjoint-${index}`,
    center: { x: (index % columns) * 2, y: Math.floor(index / columns) * 2 },
    width: 1,
    height: 1,
    layer: "top",
    availableZ: [0, 1],
  }))
  const input = createTopologyValidationInput({ nodes })
  const geometryReads = { count: 0 }
  if (trackGeometryReads) {
    for (const node of nodes) {
      const center = node.center
      Object.defineProperty(node, "center", {
        enumerable: true,
        get() { geometryReads.count += 1; return center },
      })
    }
  }
  return { input, geometryReads }
}
