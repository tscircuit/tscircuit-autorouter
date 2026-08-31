import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getRouteGeometryViolationError } from "lib/solvers/HighDensitySolver/official-high-density-a11"
import { areNodePortPointPairsConnectedByRoutes } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample002Cmn279 from "../fixtures/srj18-sample002-cmn279.json"

test("Pipeline9 A11 solves a difficult node at native size only", () => {
  const nodeWithPortPoints = sample002Cmn279 as NodeWithPortPoints
  const solver = createPipeline9RegularNodeSolver({
    nodeWithPortPoints,
    connMap: new ConnectivityMap({}),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: { cmn_279: 0 },
    obstacles: [],
    layerCount: 2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.highDensityResizeCount).toBe(0)
  expect(solver.stats.solverNodeCount.HighDensitySolverA11).toBe(1)
  expect(solver.nodeSolveMetadataById.get("cmn_279")?.solverType).toBe(
    "HighDensitySolverA11",
  )
  expect(solver.routes).toHaveLength(4)
  expect(getRouteGeometryViolationError(solver.routes)).toBeNull()
  expect(
    areNodePortPointPairsConnectedByRoutes(solver.routes, nodeWithPortPoints),
  ).toBe(true)
})
