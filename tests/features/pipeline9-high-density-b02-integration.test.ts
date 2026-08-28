import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import nodeJson from "../../fixtures/bug-reports/bugreport101-cm5-spi-routing-timeout/bugreport101-cm5-spi-dominant-high-density-node.json" with {
  type: "json",
}
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline9 uses HighDensitySolverB02 for applicable ordinary nodes", () => {
  const node = structuredClone(nodeJson) as NodeWithPortPoints
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({}),
    obstacles: [],
    layerCount: 4,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
  })

  solver.step()
  const regularSolver = solver.activeRegularSolver
  expect(regularSolver).not.toBeNull()

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.routes).toHaveLength(11)
  expect(
    regularSolver?.nodeSolveMetadataById.get(node.capacityMeshNodeId),
  ).toMatchObject({
    status: "solved",
    solverType: "HighDensitySolverB02",
    routeCount: 11,
  })
})
