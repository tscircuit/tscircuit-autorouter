import { convertRepairRoutesToTraces } from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("a locally improved but rejected region consumes the parent work budget", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  const engine = new AutoroutingDrcEngine(fixture.srj)
  const observedCounts: number[] = []
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    enabled: true,
    maxCandidateAttemptsSinceAcceptance: 1,
    referenceDrcEvaluator: ({
      routes,
    }): ReturnType<typeof fixture.referenceDrcEvaluator> => {
      if (!routes) throw new Error("Expected complete candidate routes")
      const count = engine.evaluate([
        ...fixture.srj.traces!,
        ...convertRepairRoutesToTraces(routes, fixture.srj.layerCount),
      ]).errors.length
      observedCounts.push(count)
      if (count > 0)
        return fixture.referenceDrcEvaluator({ routes, traces: [] })
      return [
        { type: "reference_constraint", center: { x: 0, y: 0 } },
        { type: "another_reference_constraint", center: { x: 0, y: 0 } },
      ]
    },
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(observedCounts).toEqual([1, 0])
  expect(solver.stats.completionReason).toBe("unsuccessful-work-budget")
  expect(solver.stats.regions).toBe(1)
  expect(solver.stats.acceptedRegions).toBe(0)
  expect(solver.stats.attemptsSinceAcceptance).toBe(1)
  expect(solver.stats.referenceErrors).toBeGreaterThan(0)
  expect(solver.stats.pathSearchNodes).toBeGreaterThan(0)
  expect(solver.getOutput()).toBe(fixture.hdRoutes)
})
