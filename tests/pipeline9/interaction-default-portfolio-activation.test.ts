import { test, expect } from "bun:test"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

test("default P9 portfolio executes interaction grouping and exposes its work at the phase wrapper", () => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 1], portPoints: [
    { connectionName: "a", x: -2, y: 0, z: 0 }, { connectionName: "a", x: 2, y: 0, z: 0 },
    { connectionName: "b", x: 0, y: -2, z: 0 }, { connectionName: "b", x: 0, y: 2, z: 0 },
    { connectionName: "c", x: -2, y: 2.7, z: 0 }, { connectionName: "c", x: 2, y: 2.7, z: 0 },
  ] }
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, obstacles: [], connections: ["a", "b", "c"].map(name => ({ name, pointsToConnect: node.portPoints.filter(p => p.connectionName === name).map(p => ({ x: p.x, y: p.y, layer: "top" })) })) }
  const solver = new Pipeline9HighDensitySolver({ nodePortPoints: [node], fixedHdRoutes: [], connMap: getConnectivityMapFromSimpleRouteJson(srj), viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.1, effort: 1, obstacles: [], layerCount: 2 })
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.stats.regularNodeCount).toBe(1)
  expect(solver.stats.experimentalInteractionInitialGroups).toBe(3)
  expect(solver.stats.experimentalInteractionMergeEvents).toBe(1)
  expect(solver.stats.experimentalInteractionChildIterations).toBeGreaterThan(0)
  expect(solver.stats.experimentalInteractionChildAllocatedIterations).toBeGreaterThan(solver.stats.experimentalInteractionNodeIterationAllowance)
  expect(solver.stats.experimentalInteractionCopperPrimitiveTests).toBeGreaterThan(0)
  expect(solver.routes).toHaveLength(3)
})
