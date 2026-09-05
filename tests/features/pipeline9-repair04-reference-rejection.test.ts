import { convertRepairRoutesToTraces } from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type DrcEvaluator,
} from "high-density-repair03/lib"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("repair04 rejects a local DRC improvement when the full-board reference worsens", () => {
  const fixture = createPipeline9Repair04Fixture()
  const originalRoutes = structuredClone(fixture.hdRoutes)
  const engine = new AutoroutingDrcEngine(fixture.srj, {
    connMap: fixture.connMap,
  })
  const observedIndexedCounts: number[] = []
  const referenceDrcEvaluator: DrcEvaluator = ({ routes }) => {
    if (!routes) throw new Error("Expected complete candidate routes")
    const errors = engine.evaluate([
      ...fixture.srj.traces!,
      ...convertRepairRoutesToTraces(routes, fixture.srj.layerCount),
    ]).errors
    observedIndexedCounts.push(errors.length)
    const result = fixture.referenceDrcEvaluator({ routes, traces: [] })
    const referenceErrors = Array.isArray(result) ? result : result.errors
    if (errors.length > 0) return referenceErrors
    return [
      {
        type: "reference_only_constraint",
        message: "Candidate violates a full-board reference constraint",
      },
      {
        type: "reference_only_constraint",
        message: "Candidate violates another full-board reference constraint",
      },
    ]
  }
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    referenceDrcEvaluator,
    enabled: true,
    maxRegions: 1,
    maxCandidatesPerRegion: 2000,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(observedIndexedCounts[0]).toBeGreaterThan(0)
  expect(observedIndexedCounts.at(-1)).toBe(0)
  expect(solver.stats.acceptedRegions).toBe(0)
  expect(solver.getOutput()).toEqual(originalRoutes)
  expect(fixture.hdRoutes).toEqual(originalRoutes)
})
