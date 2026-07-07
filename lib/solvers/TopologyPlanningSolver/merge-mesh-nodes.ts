import type { CapacityMeshNode } from "lib/types"
import type {
  SerializedTopologyComponentInput,
  TopologyMeshMergeStrategy,
} from "./MultiGraphTopologyPlannerSolver"
import { isNodeCenterInsideObstacle } from "./capacity-node-geometry"
import { getGlobalMeshNodesForMergedTopology } from "./get-global-mesh-nodes-for-merged-topology"
import { splitCapacityNodeAroundCutouts } from "./split-capacity-node-around-cutouts"

/**
 * Replaces the global component-region node with the finer component-local
 * routing regions, while preserving internal global target/obstacle nodes.
 */
export function mergeMeshNodes({
  globalMeshNodes,
  components,
  componentMeshNodes,
  mergeStrategy,
}: {
  globalMeshNodes: CapacityMeshNode[]
  components: SerializedTopologyComponentInput[]
  componentMeshNodes: CapacityMeshNode[][]
  mergeStrategy: TopologyMeshMergeStrategy
}): CapacityMeshNode[] {
  switch (mergeStrategy) {
    case "concat":
      const globalNodesForMergedTopology = getGlobalMeshNodesForMergedTopology({
        meshNodes: globalMeshNodes,
        components,
      })
      const componentMeshNodesWithCutouts = componentMeshNodes.flatMap(
        (nodes, componentIndex) => {
          const component = components[componentIndex]
          if (!component) {
            throw new Error(
              `Missing topology component for component mesh node group ${componentIndex}`,
            )
          }
          const cutoutNodes = globalNodesForMergedTopology.filter((node) =>
            isNodeCenterInsideObstacle({
              node,
              obstacle: component.replacementObstacle,
            }),
          )

          return nodes.flatMap((node) =>
            splitCapacityNodeAroundCutouts({
              node,
              cutoutNodes,
            }),
          )
        },
      )

      return [...globalNodesForMergedTopology, ...componentMeshNodesWithCutouts]
  }
}
