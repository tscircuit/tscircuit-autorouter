import cn27910 from "examples/legacy/assets/cn27910-nodeWithPortPoints.json"
import React from "react"
import { InteractiveGraphics } from "graphics-debug/react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new MultiHeadPolyLineIntraNodeSolver3({
        nodeWithPortPoints: cn27910.nodeWithPortPoints,
        hyperParameters: {
          SEGMENTS_PER_POLYLINE: 6,
        },
      })
      return solver
    }}
  />
)
