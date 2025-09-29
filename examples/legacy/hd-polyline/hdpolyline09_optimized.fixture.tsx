import cn27515 from "examples/legacy/assets/cn27515-nodeWithPortPoints.json"
import React from "react"
import { InteractiveGraphics } from "graphics-debug/react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new MultiHeadPolyLineIntraNodeSolver2({
        nodeWithPortPoints: cn27515.nodeWithPortPoints,
        hyperParameters: {
          SEGMENTS_PER_POLYLINE: 4,
        },
      })
      return solver
    }}
  />
)
