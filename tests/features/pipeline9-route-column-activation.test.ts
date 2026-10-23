import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

test("ordinary Pipeline9 routing runs priced column search and exposes work at the phase wrapper", () => {
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [{
      capacityMeshNodeId: "cross", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 1],
      portPoints: [
        { connectionName: "a", x: -3, y: 0, z: 0 }, { connectionName: "a", x: 3, y: 0, z: 0 },
        { connectionName: "b", x: 0, y: -3, z: 0 }, { connectionName: "b", x: 0, y: 3, z: 0 },
        { connectionName: "c", x: -3, y: -3, z: 0 }, { connectionName: "c", x: 3, y: 3, z: 0 },
      ],
    }],
    fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2,
    viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.1, effort: 1,
  })
  solver.solve()
  expect(solver.solved, solver.error ?? "failed").toBe(true)
  expect(solver.stats.routeColumnCandidateCount).toBeGreaterThan(0)
  expect(solver.stats.routeColumnPricingOracleCallCount).toBeGreaterThan(0)
  expect(solver.stats.routeColumnCopperGeometryCheckCount).toBeGreaterThan(0)
  expect(solver.stats.routeColumnNewPricedColumnCount).toBeGreaterThan(0)
  expect(solver.routes).toHaveLength(3)
  for (const [key, value] of Object.entries(solver.stats)) {
    if (key.startsWith("routeColumn")) expect(Number.isFinite(value)).toBe(true)
  }
})
