import type { SimpleRouteJson } from "../../types"
import { CapacityMeshNodeSolver2_NodeUnderObstacle } from "../CapacityMeshSolver/CapacityMeshNodeSolver2_NodesUnderObstacles"

interface CapacityMeshNodeSolverOptions {
  capacityDepth?: number
}

/**
 * This capacity mesh node solver is meant to be used in contexts where vias
 * aren't allowed, but there may be assignable vias on the PCB as obstacles.
 *
 * The behavior is different than other Capacity Mesh Node solvers in that:
 * - If there is no obstacle, instead of having a multi-layer capacity mesh node
 *   we have two single-layer capacity mesh nodes
 * - If we have an "assignable" obstacle, i.e. an obstacle with "netIsAssignable"
 *   set to true we create a multi-layer capacity mesh node with a capacity of
 *   1 (a single via)
 *   - NOTE: There is only ONE multi-layer capacity mesh node per assignable obstacle
 * - Mesh nodes should not be "too big", if a capacity mesh node is more than
 *   MAX_SIZE_FOR_SINGLE_LAYER_NODES it will be split into 4 smaller nodes
 */
export class CapacityMeshNodeSolver_OnlyTraverseLayersInAssignableObstacles extends CapacityMeshNodeSolver2_NodeUnderObstacle {
  MAX_SIZE_FOR_SINGLE_LAYER_NODES = 4 // 4x4mm

  constructor(
    public srj: SimpleRouteJson,
    public opts: CapacityMeshNodeSolverOptions = {},
  ) {
    super(srj, opts)
  }
}
