import type { NodeWithPortPoints } from "../../lib/types/high-density-types"
import { createFlexibleBoundaryFixture } from "./flexibleBoundaryFixture"

export const createOrderedPortalFixture = (): NodeWithPortPoints[] => {
  const nodes = createFlexibleBoundaryFixture()
  for (const node of nodes) for (const point of node.portPoints) {
    if (point.portPointId!.startsWith("seam")) point.y *= 0.5
    else point.y *= 1.5
  }
  return nodes
}
