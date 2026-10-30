import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("absent and false feedback preserve native false-zero output, iteration budget and statistics exactly", (): void => {
  for (const gap of [0.06151, -0.1]) {
    const fixture = makeOriginalOwnerCopperFeedbackFixture(gap)
    const absent = new Pipeline9JointDrcRepairSolver(fixture.params)
    const disabled = new Pipeline9JointDrcRepairSolver({ ...fixture.params, experimentOriginalOwnerCopperFeedback: false })
    absent.solve(); disabled.solve()
    expect(disabled.getOutput()).toEqual(absent.getOutput())
    expect(disabled.iterations).toBe(absent.iterations)
    expect(disabled.MAX_ITERATIONS).toBe(absent.MAX_ITERATIONS)
    expect(disabled.stats).toEqual(absent.stats)
    expect(disabled.stats.originalOwnerCopperFeedback).toBeUndefined()
  }
})
