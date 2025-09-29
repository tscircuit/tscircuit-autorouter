import cn38402 from "examples/legacy/assets/cn38402-nodeWithPortPoints.json"
import React from "react"
import { InteractiveGraphics } from "graphics-debug/react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new MultiHeadPolyLineIntraNodeSolver3({
        nodeWithPortPoints: cn38402.nodeWithPortPoints,
        hyperParameters: {
          SEGMENTS_PER_POLYLINE: 6,
        },
      })
      return solver
    }}
  />
)
