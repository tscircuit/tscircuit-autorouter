import * as React from "react"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { SingleTransitionCrossingRouteSolver } from "lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"

export default function ClosedFormSingleCrossingSolverFixture() {
  // Create a test node with two routes that cross
  // One route has a z-transition, the other stays on the same layer
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "test-node",
    center: { x: 0, y: 0 },
    width: 2.4,
    height: 2.4,
    portPoints: [
      // Transition route (layer 0 to layer 1)
      { x: -1.2, y: -1.2, z: 0, connectionName: "route1" },
      { x: 1.2, y: 1.2, z: 1, connectionName: "route1" },

      // Flat route (stays on layer 0)
      { x: -1.2, y: 1.2, z: 0, connectionName: "route2" },
      { x: -0.4, y: -1.2, z: 0, connectionName: "route2" },
    ],
  }

  return (
    <div>
      <h2>Single Transition Crossing Route Solver</h2>
      <p>
        This solver handles cases where two routes cross, with one route having
        a layer transition and the other staying on the same layer.
      </p>
      <GenericSolverDebugger
        createSolver={() => {
          const solver = new SingleTransitionCrossingRouteSolver({
            nodeWithPortPoints,
            viaDiameter: 0.6,
            traceThickness: 0.15,
            obstacleMargin: 0.1,
          })
          return solver
        }}
      />
    </div>
  )
}
