import cn27515 from "examples/legacy/assets/cn27515-nodeWithPortPoints.json"
import React from "react"
import { InteractiveGraphics } from "graphics-debug/react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new MultiHeadPolyLineIntraNodeSolver3({
        nodeWithPortPoints: cn27515.nodeWithPortPoints,
        hyperParameters: {
          SEGMENTS_PER_POLYLINE: 6,
        },
      })
      return solver
    }}
  />
)
