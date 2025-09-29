import { InteractiveGraphics } from "graphics-debug/react"
import { CapacityMeshNodeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver1"
import type { SimpleRouteJson } from "lib/types"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { CapacityNodeTargetMerger } from "lib/solvers/CapacityNodeTargetMerger/CapacityNodeTargetMerger"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { CapacityMeshNodeSolver2_NodeUnderObstacle } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver2_NodesUnderObstacles"
import meshunderobstacle1 from "../assets/meshunderobstacle1.json"

export default () => {
  // Solve for mesh nodes using the CapacityMeshNodeSolver
  const nodeSolver = new CapacityMeshNodeSolver2_NodeUnderObstacle(
    meshunderobstacle1 as SimpleRouteJson,
  )
  const connMap = getConnectivityMapFromSimpleRouteJson(
    meshunderobstacle1 as SimpleRouteJson,
  )
  while (!nodeSolver.solved) {
    nodeSolver.step()
  }

  // Combine finished and unfinished nodes for edge solving
  const allNodes = [...nodeSolver.finishedNodes, ...nodeSolver.unfinishedNodes]

  const nodeTargetMerger = new CapacityNodeTargetMerger(
    allNodes,
    (meshunderobstacle1 as SimpleRouteJson).obstacles,
    connMap,
  )
  nodeTargetMerger.solve()

  // Solve for mesh edges
  const edgeSolver = new CapacityMeshEdgeSolver(nodeTargetMerger.newNodes)
  edgeSolver.solve()

  return (
    <InteractiveGraphics
      graphics={combineVisualizations(
        nodeSolver.visualize(),
        nodeTargetMerger.visualize(),
        edgeSolver.visualize(),
      )}
    />
  )
}
