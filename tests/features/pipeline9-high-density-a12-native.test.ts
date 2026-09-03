import { expect, test } from "bun:test"
import { getRouteGeometryViolationError } from "@tscircuit/high-density-a01"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { doRoutesCoverNodePortPointPairsExactlyOnce } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample003Cmn70 from "../fixtures/hd30-sample003-cmn70.json"

test("Pipeline9 A12 solves its HD30 node without growth", () => {
  const nodeWithPortPoints = sample003Cmn70 as NodeWithPortPoints
  const solver = createPipeline9RegularNodeSolver({
    nodeWithPortPoints,
    connMap: new ConnectivityMap({}),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: { cmn_70: 0 },
    obstacles: [],
    layerCount: 4,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.highDensityResizeCount).toBe(0)
  expect(solver.stats.solverNodeCount.HighDensitySolverA12).toBe(1)
  expect(solver.nodeSolveMetadataById.get("cmn_70")?.solverType).toBe(
    "HighDensitySolverA12",
  )
  expect(solver.routes).toHaveLength(5)
  expect(getRouteGeometryViolationError(solver.routes)).toBeNull()
  expect(
    doRoutesCoverNodePortPointPairsExactlyOnce(
      solver.routes,
      nodeWithPortPoints,
    ),
  ).toBe(true)
})
