import { expect, test } from "bun:test"
import type { ClearancePathInput } from "@tscircuit/repair04"
import { FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/incrementalRepair/FindClearancePathSolver"
import { IncrementalRepairWorkBudget, RetainedHardSpacePotentials } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/incrementalRepair/RetainedHardSpacePotential"

test("valid native sparse grids outside the retained domain return explicit unknown without a native fallback", () => {
  const route = { connectionName: "wire", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [] }
  const input: ClearancePathInput = { srj: { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -50, maxX: 50, minY: -50, maxY: 50 }, connections: [], obstacles: [] }, routes: [route], routeIndex: 0, start: route.route[0]!, end: route.route[1]!, bounds: { minX: -50, maxX: 50, minY: -50, maxY: 50 }, gridSize: 0.01, traceThickness: 0.1, traceClearance: 0.1, viaClearance: 0.1, maxNodes: 1000 }
  const work = new IncrementalRepairWorkBudget(10000)
  const solver = new FindClearancePathSolver(input, new RetainedHardSpacePotentials(work))
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toBe(null)
  expect(solver.exhaustionReason).toBe("retained-domain-limit")
  expect(solver.stats.completionReason).toBe("node-limit")
  expect(solver.stats.nodesPopped).toBe(0)
  expect(work.counters.domainLimitStops).toBe(1)
})
