import { test, expect } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import cn705 from "examples/legacy/assets/cn705-nodeWithPortPoints.json"
import "graphics-debug/matcher"

test("hdpolyline11", () => {
  const solver = new MultiHeadPolyLineIntraNodeSolver({
    nodeWithPortPoints: cn705.nodeWithPortPoints,
    hyperParameters: {
      MULTI_HEAD_POLYLINE_SOLVER: true,
      SEGMENTS_PER_POLYLINE: 6,
      BOUNDARY_PADDING: -0.05,
    },
  })
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
  expect({
    solvedRoutes: solver.solvedRoutes,
    unsolvedConnections: solver.unsolvedConnections,
  }).toMatchInlineSnapshot(`
    {
      "solvedRoutes": [],
      "unsolvedConnections": [],
    }
  `)
})
