import type { CapacityMeshNode } from "lib/types"
import type { SerializedTopologyComponentInput } from "./MultiGraphTopologyPlannerSolver"
import {
  GEOMETRY_EPSILON,
  isNodeCenterInsideObstacle,
  isNodeInsideOrOverlappingObstacle,
} from "./capacity-node-geometry"

export function getGlobalMeshNodesForMergedTopology({
  meshNodes,
  components,
}: {
  meshNodes: CapacityMeshNode[]
  components: SerializedTopologyComponentInput[]
}): CapacityMeshNode[] {
  if (components.length === 0) return meshNodes

  return meshNodes.filter((node) =>
    components.every((component) => {
      if (isReplacementRegionNode({ node, component })) return false
      if (
        isNodeInsideOrOverlappingObstacle({
          node,
          obstacle: component.replacementObstacle,
        })
      ) {
        if (
          isNodeCenterInsideObstacle({
            node,
            obstacle: component.replacementObstacle,
          })
        ) {
          return Boolean(node._containsObstacle || node._containsTarget)
        }

        return true
      }

      return true
    }),
  )
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
