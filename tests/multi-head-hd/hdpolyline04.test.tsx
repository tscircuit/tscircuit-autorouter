import { test, expect } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import cn48169 from "examples/legacy/assets/cn48169-nodeWithPortPoints.json"
import "graphics-debug/matcher"

test("hdpolyline04", () => {
  const solver = new MultiHeadPolyLineIntraNodeSolver({
    nodeWithPortPoints: cn48169.nodeWithPortPoints,
    hyperParameters: {
      BOUNDARY_PADDING: -0.1,
    },
  })
  solver.solve()
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
  expect(solver.solved).toBe(true)
})
