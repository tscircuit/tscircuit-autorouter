import type { CapacityMeshNode } from "lib/types"
import type { SerializedTopologyComponentInput } from "./MultiGraphTopologyPlannerSolver"
import { GEOMETRY_EPSILON } from "./capacity-node-geometry"

/**
 * Retains the global topology as an input to common refinement. RectDiff marks
 * synthetic component replacement regions as obstacles and targets; that
 * metadata describes the temporary global solve, not physical copper or net
 * ownership, so it is cleared before component-local topology is overlaid.
 */
export function getGlobalMeshNodesForTopologyMerging({
  meshNodes,
  components,
}: {
  meshNodes: CapacityMeshNode[]
  components: SerializedTopologyComponentInput[]
}): CapacityMeshNode[] {
  if (components.length === 0) return meshNodes

  return meshNodes.map((node) => {
    const isSyntheticComponentRegion = components.some((component) =>
      isReplacementRegionNode({ node, component }),
    )
    if (!isSyntheticComponentRegion) return node

    return {
      ...node,
      _containsObstacle: undefined,
      _completelyInsideObstacle: undefined,
      _containsTarget: undefined,
      _targetConnectionName: undefined,
      _connectedTo: undefined,
    }
  })
}

/** Matches a global routing region against a detected component replacement obstacle. */
function isReplacementRegionNode({
  node,
  component,
}: {
  node: CapacityMeshNode
  component: SerializedTopologyComponentInput
}): boolean {
  const { replacementObstacle } = component
  const isExactReplacementNode =
    Math.abs(node.center.x - replacementObstacle.center.x) <=
      GEOMETRY_EPSILON &&
    Math.abs(node.center.y - replacementObstacle.center.y) <=
      GEOMETRY_EPSILON &&
    Math.abs(node.width - replacementObstacle.width) <= GEOMETRY_EPSILON &&
    Math.abs(node.height - replacementObstacle.height) <= GEOMETRY_EPSILON

  if (
    component.componentKind !== "qfp" &&
    component.componentKind !== "qfp_thermalpad" &&
    component.componentKind !== "soic"
  ) {
    return isExactReplacementNode
  }

  const replacementMinX =
    replacementObstacle.center.x - replacementObstacle.width / 2
  const replacementMaxX =
    replacementObstacle.center.x + replacementObstacle.width / 2
  const replacementMinY =
    replacementObstacle.center.y - replacementObstacle.height / 2
  const replacementMaxY =
    replacementObstacle.center.y + replacementObstacle.height / 2
  const nodeCenterInsideReplacement =
    node.center.x >= replacementMinX - GEOMETRY_EPSILON &&
    node.center.x <= replacementMaxX + GEOMETRY_EPSILON &&
    node.center.y >= replacementMinY - GEOMETRY_EPSILON &&
    node.center.y <= replacementMaxY + GEOMETRY_EPSILON
  const nodeArea = node.width * node.height
  const replacementArea = replacementObstacle.width * replacementObstacle.height
  const isLargeReplacementNode =
    nodeCenterInsideReplacement && nodeArea >= replacementArea * 0.2

  return isExactReplacementNode || isLargeReplacementNode
}
