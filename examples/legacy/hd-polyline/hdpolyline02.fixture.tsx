import React from "react"
import { InteractiveGraphics } from "graphics-debug/react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"

const nodeWithPortPoints = {
  capacityMeshNodeId: "node1",
  center: { x: 5, y: 5 },
  width: 2,
  height: 2,
  portPoints: [
    { connectionName: "A", x: 4, y: 4, z: 1 },
    { connectionName: "A", x: 6, y: 6, z: 0 },
    { connectionName: "B", x: 5, y: 4, z: 0 },
    { connectionName: "B", x: 4, y: 6, z: 1 },
  ],
}

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new MultiHeadPolyLineIntraNodeSolver({
        nodeWithPortPoints,
      })
      return solver
    }}
  />
)
