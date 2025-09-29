import { InteractiveGraphics } from "graphics-debug/react"
import { CapacityMeshNodeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver1"
import type { SimpleRouteJson } from "lib/types"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { CapacityPathingSolver } from "lib/solvers/CapacityPathingSolver/CapacityPathingSolver"
import { getColorMap } from "lib/solvers/colors"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { CapacityNodeTargetMerger } from "lib/solvers/CapacityNodeTargetMerger/CapacityNodeTargetMerger"

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
    {
      name: "trace3",
      pointsToConnect: [
        {
          x: 0,
          y: 0,
          layer: "top",
        },
        {
          x: 100,
          y: 100,
          layer: "top",
        },
      ],
    },
  ],
} as SimpleRouteJson

export default () => {
  // Solve for mesh nodes using the CapacityMeshNodeSolver
  const nodeSolver = new CapacityMeshNodeSolver(simpleSrj)
  while (!nodeSolver.solved) {
    nodeSolver.step()
  }

  // Combine finished and unfinished nodes for edge solving
  let allNodes = [...nodeSolver.finishedNodes, ...nodeSolver.unfinishedNodes]

  const nodeTargetMerger = new CapacityNodeTargetMerger(
    allNodes,
    simpleSrj.obstacles,
    getConnectivityMapFromSimpleRouteJson(simpleSrj),
  )
  nodeTargetMerger.solve()
  allNodes = nodeTargetMerger.newNodes

  // Solve for mesh edges
  const edgeSolver = new CapacityMeshEdgeSolver(allNodes)
  edgeSolver.solve()

  // Get color map for visualization
  const colorMap = getColorMap(simpleSrj)

  // Create and solve capacity pathing
  const pathingSolver = new CapacityPathingSolver({
    simpleRouteJson: simpleSrj,
    nodes: allNodes,
    edges: edgeSolver.edges,
    colorMap,
  })

  pathingSolver.solve()

  return <InteractiveGraphics graphics={pathingSolver.visualize()} />
}
