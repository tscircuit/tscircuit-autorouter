import { expect, test } from "bun:test"
import { Pipeline9IndexedClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9IndexedClearanceProjectionSolver"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("indexed clearance projection retains terminal copper and guarded partial publication", (): void => {
  for (const partial of [false, true]) {
    const fixture = createBoundedRegionalRepairFixture(3)
    fixture.routes = fixture.routes.map((route) => ({
      ...route,
      route: [
        { ...route.route[0]!, pcb_port_id: "start" },
        { x: -1, y: route.route[0]!.y + 0.28, z: 0 },
        { x: 1, y: route.route[0]!.y + 0.28, z: 0 },
        { ...route.route.at(-1)!, pcb_port_id: "end" },
      ],
    }))
    const original = structuredClone(fixture.routes)
    const params = { ...fixture, allowPartialRepair: partial, subdivideSegments: true, usePrecisionMargin: true }
    const baseline = new Pipeline9ClearanceProjectionSolver(params)
    const indexed = new Pipeline9IndexedClearanceProjectionSolver(params)
    while (!baseline.solved && !baseline.failed) {
      baseline.step()
      indexed.step()
      expect(indexed.activeSubSolver?.stats).toEqual(baseline.activeSubSolver?.stats)
      expect(indexed.solved).toBe(baseline.solved)
      expect(indexed.progress).toBe(baseline.progress)
      expect(indexed.MAX_ITERATIONS).toBe(baseline.MAX_ITERATIONS)
    }
    expect(indexed.failed).toBeFalse()
    expect(indexed.getOutput()).toEqual(baseline.getOutput())
    expect(indexed.iterations).toBe(baseline.iterations)
    expect(fixture.routes).toEqual(original)
    expect(indexed.getOutput()).not.toEqual(original)
    for (const [index, route] of indexed.getOutput().entries()) {
      expect(route.route[0]).toEqual(original[index]!.route[0])
      expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1))
    }
  }
})
