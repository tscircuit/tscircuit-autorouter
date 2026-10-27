import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline9 regional retries disable the same search history as regular routing", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "regional-debug-crossing",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [
      { x: -1, y: 0, z: 0, connectionName: "horizontal" },
      { x: 1, y: 0, z: 0, connectionName: "horizontal" },
      { x: 0, y: -1, z: 0, connectionName: "vertical" },
      { x: 0, y: 1, z: 0, connectionName: "vertical" },
    ],
  }
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({}),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
  })
  solver.step()
  expect(solver.activeRegularSolver?.captureSearchDebug).toBeFalse()
  while (!solver.activeFallbackSolver && !solver.solved && !solver.failed) {
    solver.step()
  }
  const regional = solver.activeFallbackSolver
  expect(regional).not.toBeNull()
  expect(regional?.highDensitySolver.captureSearchDebug).toBeFalse()
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.stats.fallbackNodeCount).toBe(1)
  expect(solver.routes).toHaveLength(2)
})
