import { expect, test } from "bun:test"
import { FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/FindClearancePathSolver"

test("a production finite-event attempt keeps its native pop allowance and never dispatches grid search after exhaustion", (): void => {
  const route = { connectionName: "ab", rootConnectionName: "ab", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0.25, y: 0.25, z: 0 }, { x: 2.75, y: 0.25, z: 0 }], vias: [] }
  const solver = new FindClearancePathSolver({
    srj: { layerCount: 1, minTraceWidth: 0.1, bounds: { minX: 0, maxX: 3, minY: 0, maxY: 1 },
      obstacles: [{ type: "rect", center: { x: 1.5, y: 0.5 }, width: 0.2, height: 3, layers: ["top"], connectedTo: [] }],
      connections: [{ name: "ab", pointsToConnect: [{ x: 0.25, y: 0.25, layer: "top" }, { x: 2.75, y: 0.25, layer: "top" }] }] },
    routes: [route], routeIndex: 0, start: route.route[0]!, end: route.route.at(-1)!,
    bounds: { minX: 0, maxX: 3, minY: 0, maxY: 1 }, traceThickness: 0.1, traceClearance: 0.1, viaClearance: 0.1,
    gridSize: 0.1, allowLayerChanges: false, maxNodes: 1,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toBeNull()
  expect(solver.stats).toMatchObject({ searchGraph: "corridors", corridorSparsePolicy: 1, corridorMaintenanceLimitReached: 0 })
  expect(solver.stats.nodesPopped).toBe(1)
  expect(solver.stats.completionReason).toBe("node-limit")
})
