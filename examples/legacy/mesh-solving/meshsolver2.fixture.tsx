import { InteractiveGraphics } from "graphics-debug/react"
import { CapacityMeshNodeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver1"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import type { SimpleRouteJson } from "lib/types"

const simpleSrj: SimpleRouteJson = {
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
  ],
  connections: [
    {
      name: "trace1",
      pointsToConnect: [
        {
          x: 10,
          y: 10,
          layer: "top",
        },
        {
          x: 50,
          y: 90,
          layer: "top",
        },
      ],
    },
    {
      name: "trace2",
      pointsToConnect: [
        {
          x: 10,
          y: 50,
          layer: "top",
        },
        {
          x: 90,
          y: 30,
          layer: "top",
        },
      ],
    },
  ],
}

export default () => {
  // Solve for mesh nodes using the CapacityMeshNodeSolver
  const nodeSolver = new CapacityMeshNodeSolver(simpleSrj)
  while (!nodeSolver.solved) {
    nodeSolver.step()
  }

  // Combine finished and unfinished nodes for edge solving
  const allNodes = [...nodeSolver.finishedNodes, ...nodeSolver.unfinishedNodes]

  // Solve for mesh edges
  const edgeSolver = new CapacityMeshEdgeSolver(allNodes)
  edgeSolver.solve()

  // Render the visualization using InteractiveGraphics
  return <InteractiveGraphics graphics={edgeSolver.visualize()} />
}
