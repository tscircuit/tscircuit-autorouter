import { InteractiveGraphics } from "graphics-debug/react"
import { CapacityMeshNodeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver1"
import type { SimpleRouteJson } from "lib/types"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { CapacityNodeTargetMerger } from "lib/solvers/CapacityNodeTargetMerger/CapacityNodeTargetMerger"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { SingleLayerNodeMergerSolver } from "lib/solvers/SingleLayerNodeMerger/SingleLayerNodeMergerSolver"
import { CapacityMeshNodeSolver2_NodeUnderObstacle } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver2_NodesUnderObstacles"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"

const simpleSrj = {
  bounds: {
    minX: 0,
    maxX: 100,
    minY: 0,
    maxY: 100,
  },
  layerCount: 1,
  minTraceWidth: 1,
  obstacles: [
    {
      center: {
        x: 60,
        y: 40,
      },
      width: 20,
      height: 30,
      type: "rect",
      layers: ["top"],
      connectedTo: [],
    },
    {
      center: {
        x: 40,
        y: 40,
      },
      width: 50,
      height: 10,
      type: "rect",
      layers: ["top"],
      connectedTo: [],
    },
  ],
  connections: [
    {
      name: "trace1",
      pointsToConnect: [
        {
          x: 15,
          y: 10,
          layer: "top",
        },
        {
          x: 55,
          y: 90,
          layer: "top",
        },
      ],
    },
  ],
} as SimpleRouteJson

export default () => {
  // Solve for mesh nodes using the CapacityMeshNodeSolver
  const nodeSolver = new CapacityMeshNodeSolver2_NodeUnderObstacle(simpleSrj)
  nodeSolver.solve()

  return (
    <GenericSolverDebugger
      createSolver={() => {
        const singleLayerNodeMerger = new SingleLayerNodeMergerSolver(
          nodeSolver.finishedNodes,
        )
        return singleLayerNodeMerger
      }}
    />
  )
}
