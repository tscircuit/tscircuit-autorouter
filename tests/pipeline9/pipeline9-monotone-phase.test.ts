import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

test("HD phase reuses a collective affine template across mixed-layer cells and records committed geometry separately", () => {
  const nodes = [0, 30].map((x, cell) => ({ capacityMeshNodeId: `cell${cell}`, center: { x, y: 0 }, width: 20, height: 6,
    portPoints: [-0.4, 0, 0.4].flatMap((y, i) => [{ x: x - 10.00005, y, z: 0, connectionName: `n${cell}-${i}` }, { x: x + 10.00005, y, z: 1, connectionName: `n${cell}-${i}` }]) }))
  const solver = new Pipeline9HighDensitySolver({ enableMonotoneFamilyCompilation: true, nodePortPoints: nodes, fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2, viaDiameter: 0.6, viaHoleDiameter: 0.3, viaHoleClearance: 0.1, traceWidth: 0.15, obstacleMargin: 0.15, effort: 1 })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routes).toHaveLength(6)
  expect(solver.stats.monotoneFamilyContinuousSolves).toBe(1)
  expect(solver.stats.monotoneFamilyTemplateCacheHits).toBe(1)
  expect(solver.stats.monotoneFamilyCommittedCollectiveCells).toBe(2)
  expect(solver.stats.monotoneFamilyCommittedSinglePairCells).toBe(0)
  expect(solver.stats.monotoneFamilyConstructedVias).toBe(6)
  expect(solver.stats.monotoneFamilyConstructedRoutes).toBe(6)
  expect(solver.stats.regularNodeCount).toBe(0)
  for (const [key, value] of Object.entries(solver.stats)) if (key.startsWith("monotoneFamily")) expect(Number.isFinite(value)).toBe(true)
})
