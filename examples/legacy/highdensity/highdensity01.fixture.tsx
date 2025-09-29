import React from "react"
import { InteractiveGraphics } from "graphics-debug/react"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

const exampleRoutes = [
  {
    connectionName: "obstacle1",
    traceThickness: 0.15,
    viaDiameter: 0.6,
    route: [
      { x: 20, y: 20, z: 0 },
      { x: 20, y: 80, z: 0 },
    ],
    vias: [{ x: 20, y: 50 }],
  },
  {
    connectionName: "obstacle2",
    traceThickness: 0.15,
    viaDiameter: 0.6,
    route: [
      { x: 70, y: 30, z: 0 },
      { x: 70, y: 90, z: 0 },
    ],
    vias: [{ x: 70, y: 60 }],
  },
]

export default () => {
  // Create a solver instance with example data.
  const solver = new SingleHighDensityRouteSolver({
    connectionName: "test_route",
    obstacleRoutes: exampleRoutes,
    bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    A: { x: 0, y: 0, z: 0 },
    B: { x: 100, y: 100, z: 0 },
    viaDiameter: 0.6,
    traceThickness: 0.15,
    obstacleMargin: 1,
    layerCount: 2,
    minDistBetweenEnteringPoints: 1,
  })

  // Solve the route.
  solver.solve()

  // Visualize the computed route using the solver's visualize method.
  const graphics = solver.solvedPath ? solver.visualize() : { lines: [] }

  return <InteractiveGraphics graphics={graphics} />
}
