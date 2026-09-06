import * as repair04 from "@tscircuit/repair04"
import { expect, spyOn, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("advanced repair does not crop an existing-via pass without selected vias", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  const extract = spyOn(repair04, "extractRepairRegion")
  try {
    const solver = new Pipeline9Repair04Solver({
      ...fixture,
      allowLayerChanges: true,
      traceOnlyFirst: false,
      maxRegions: 1,
      maxCandidatesPerRegion: 1,
      referenceDrcEvaluator: () => [
        { type: "fixed_reference_issue", center: { x: 100, y: 100 } },
      ],
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.stats.regions).toBe(1)
    expect(solver.stats.acceptedRegions).toBe(0)
    expect(extract).toHaveBeenCalledTimes(1)
    expect(solver.getOutput()).toBe(fixture.hdRoutes)
  } finally {
    extract.mockRestore()
  }
})
