import { InteractiveGraphics } from "graphics-debug/react"
import { CapacityMeshNodeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver1"
import type { SimpleRouteJson } from "lib/types"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { CapacityNodeTargetMerger } from "lib/solvers/CapacityNodeTargetMerger/CapacityNodeTargetMerger"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

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
        x: 50,
        y: 50,
      },
      width: 20,
      height: 10,
      type: "rect",
      layers: ["top", "bottom"],
      connectedTo: [],
    },
    {
      center: {
        x: 55,
        y: 90,
      },
      width: 20,
      height: 10,
      type: "rect",
      layers: ["top", "bottom"],
      connectedTo: [],
    },
    {
      center: {
        x: 15,
        y: 10,
      },
      width: 50,
      height: 10,
      type: "rect",
      layers: ["top", "bottom"],
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
    {
      name: "trace2",
      pointsToConnect: [
        {
          x: 40,
          y: 10,
          layer: "top",
        },
        {
          x: 40,
          y: 50,
          layer: "top",
        },
      ],
    },
  ],
} as SimpleRouteJson

export default () => {
  // Solve for mesh nodes using the CapacityMeshNodeSolver
  const nodeSolver = new CapacityMeshNodeSolver(simpleSrj)
  const connMap = getConnectivityMapFromSimpleRouteJson(simpleSrj)
  while (!nodeSolver.solved) {
    nodeSolver.step()
  }

  // Combine finished and unfinished nodes for edge solving
  const allNodes = [...nodeSolver.finishedNodes, ...nodeSolver.unfinishedNodes]

  const nodeTargetMerger = new CapacityNodeTargetMerger(
    allNodes,
    simpleSrj.obstacles,
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
