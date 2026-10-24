import { expect, test } from "bun:test"
import type { ClearancePathInput } from "@tscircuit/repair04"
import { FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/incrementalRepair/FindClearancePathSolver"
import { IncrementalRepairWorkBudget, RetainedHardSpacePotentials } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/incrementalRepair/RetainedHardSpacePotential"

test("aggregate setup exhaustion is an explicit bounded unknown with no fabricated path or no-path proof", () => {
  const route = { connectionName: "wire", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [] }
  const input: ClearancePathInput = { srj: { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, connections: [], obstacles: [] }, routes: [route], routeIndex: 0, start: route.route[0]!, end: route.route[1]!, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, traceThickness: 0.1, traceClearance: 0.1, viaClearance: 0.1, maxNodes: 1000 }
  for (const cap of [0, 1, 2, 4, 8, 16]) {
    const work = new IncrementalRepairWorkBudget(cap)
    const solver = new FindClearancePathSolver(input, new RetainedHardSpacePotentials(work))
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.getOutput()).toBe(null)
    expect(solver.stats.completionReason).toBe("node-limit")
    expect(solver.exhaustionReason).toBe("aggregate-work-limit")
    expect(work.counters.aggregateWork).toBeLessThanOrEqual(cap)
    expect(work.counters.nativeHeapPops).toBe(0)
  }
})
