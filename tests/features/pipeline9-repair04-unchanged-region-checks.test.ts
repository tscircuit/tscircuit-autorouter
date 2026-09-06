import { expect, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("an unchanged bounded result reuses its existing full-board validation", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  let referenceCalls = 0
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    enabled: true,
    maxRegions: 1,
    maxCandidatesPerRegion: 1,
    referenceDrcEvaluator: () => {
      referenceCalls++
      return [{ type: "fixed_reference_issue", center: { x: 100, y: 100 } }]
    },
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.stats.regions).toBe(1)
  expect(solver.stats.acceptedRegions).toBe(0)
  expect(referenceCalls).toBe(1)
  expect(solver.getOutput()).toBe(fixture.hdRoutes)
  expect(solver.getOutput()[0]).toBe(fixture.hdRoutes[0])
})
