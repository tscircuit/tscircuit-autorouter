import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"

test("phase commits a collective family without invoking a native node solver", () => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "family", center: { x: 0, y: 0 }, width: 10, height: 6,
    portPoints: [[-4, 4], [-3, 3], [-2, 2]].flatMap(([a, b], i) => [{ x: a!, y: -3, z: 0, connectionName: `n${i}` }, { x: b!, y: -3, z: 0, connectionName: `n${i}` }]) }
  const solver = new Pipeline9HighDensitySolver({ enableThickFamilyCompilation: true, nodePortPoints: [node], fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2, viaDiameter: 0.6, traceWidth: 0.2, obstacleMargin: 0.15, effort: 1 })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.routes).toHaveLength(3)
  expect(solver.stats.thickFamilyDeferredCells).toBe(1)
  expect(solver.stats.thickFamilySolvedCells).toBe(1)
  expect(solver.stats.regularNodeCount).toBe(0)
  expect(solver.stats.solvedNodeCount).toBe(1)
  for (const [key, value] of Object.entries(solver.stats)) if (key.startsWith("thickFamily")) expect(Number.isFinite(value)).toBe(true)
})
