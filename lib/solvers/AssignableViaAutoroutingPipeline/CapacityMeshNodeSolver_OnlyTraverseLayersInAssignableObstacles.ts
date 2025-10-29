import type { SimpleRouteJson } from "../../types"
import { CapacityMeshNodeSolver2_NodeUnderObstacle } from "../CapacityMeshSolver/CapacityMeshNodeSolver2_NodesUnderObstacles"

interface CapacityMeshNodeSolverOptions {
  capacityDepth?: number
}

export class CapacityMeshNodeSolver_OnlyTraverseLayersInAssignableObstacles extends CapacityMeshNodeSolver2_NodeUnderObstacle {
  constructor(
    public srj: SimpleRouteJson,
    public opts: CapacityMeshNodeSolverOptions = {},
  ) {
    super(srj, opts)
  }
}
