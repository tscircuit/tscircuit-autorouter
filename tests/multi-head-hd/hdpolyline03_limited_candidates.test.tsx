import { test, expect } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import cn9630 from "examples/legacy/assets/cn9630-nodeWithPortPoints.json"
import "graphics-debug/matcher"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"

test("hdpolyline03", () => {
  const solver = new MultiHeadPolyLineIntraNodeSolver3({
    nodeWithPortPoints: cn9630.nodeWithPortPoints,
    hyperParameters: {
      SEGMENTS_PER_POLYLINE: 5,
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
