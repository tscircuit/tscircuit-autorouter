import { expect, test } from "bun:test"
import { FindClearancePathSolver as Reference } from "@tscircuit/repair04"
import { FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/FindClearancePathSolver"
import { PersistentClearanceSearchStore } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/PersistentClearanceSearch"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("cold persistent queries preserve the original pop allowance on long obstacle detours", (): void => {
  for (const height of [0.4, 3, 8]) {
    const fixture = createBoundedRegionalRepairFixture()
    const srj = { ...fixture.originalSrj, traces: undefined }
    srj.obstacles[2]!.height = height
    const route = fixture.routes[0]!
    const input = {
      srj, routes: [route], routeIndex: 0,
      start: route.route[0]!, end: route.route.at(-1)!, bounds: srj.bounds,
      traceThickness: route.traceThickness, traceClearance: 0.1, viaClearance: 0.1,
      gridSize: 0.1, allowLayerChanges: false, maxNodes: 30_000,
    }
    const reference = new Reference(input)
    const candidate = new FindClearancePathSolver({
      ...input, persistentSearchStore: new PersistentClearanceSearchStore(),
      persistentSearchKey: "physical-detour",
    })
    reference.solve()
    candidate.solve()
    expect(reference.getOutput()).not.toBeNull()
    expect(candidate.getOutput()).not.toBeNull()
    expect(candidate.stats.completionReason).toBe("found")
    expect(candidate.stats.nodesPopped).toBeLessThanOrEqual(input.maxNodes)
    expect(candidate.persistentStats!.maximumPoppedNodes).toBe(input.maxNodes)
    expect(candidate.persistentStats!.maintenanceLimitReached).toBe(0)
    expect(candidate.stats.workUnits!).toBeLessThanOrEqual(
      candidate.persistentStats!.maximumMaintenanceWorkUnits,
    )
    expect(candidate.getOutput()![0]).toEqual(input.start)
    expect(candidate.getOutput()!.at(-1)).toEqual(input.end)
    if (height === 8) expect(candidate.stats.workUnits!).toBeGreaterThan(input.maxNodes)
  }
})
