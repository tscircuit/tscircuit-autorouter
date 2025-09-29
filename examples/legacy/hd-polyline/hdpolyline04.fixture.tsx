import cn48169 from "examples/legacy/assets/cn48169-nodeWithPortPoints.json"
import React from "react"
import { InteractiveGraphics } from "graphics-debug/react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new MultiHeadPolyLineIntraNodeSolver({
        nodeWithPortPoints: cn48169.nodeWithPortPoints,
        hyperParameters: {
          BOUNDARY_PADDING: -0.1,
        },
      })
      return solver
    }}
  />
)
