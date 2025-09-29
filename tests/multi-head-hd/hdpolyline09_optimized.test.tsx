import { test, expect } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import cn27515 from "examples/legacy/assets/cn27515-nodeWithPortPoints.json"
import "graphics-debug/matcher"

test("hdpolyline09_optimized", () => {
  const solver = new MultiHeadPolyLineIntraNodeSolver2({
    nodeWithPortPoints: cn27515.nodeWithPortPoints,
    hyperParameters: {
      SEGMENTS_PER_POLYLINE: 4,
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
