import { InteractiveGraphics } from "graphics-debug/react"
import { CapacityMeshNodeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver1"

export default () => {
  const meshSolver = new CapacityMeshNodeSolver({
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
  })
  meshSolver.solve()
  return <InteractiveGraphics graphics={meshSolver.visualize()} />
}
