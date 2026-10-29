import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { makeJointOriginalViaPlacementFixture } from "./fixtures/pipeline9JointOriginalViaPlacement"

test("an explicit false via-placement option preserves default output, work, and budgets", (): void => {
  for (const kind of ["board", "foreign-pad"] as const) {
    const defaultFixture = makeJointOriginalViaPlacementFixture(kind)
    const disabledFixture = makeJointOriginalViaPlacementFixture(kind)
    const standard = new Pipeline9JointDrcRepairSolver(defaultFixture.params)
    const disabled = new Pipeline9JointDrcRepairSolver({ ...disabledFixture.params, checkOriginalViaPlacement: false })
    standard.solve()
    disabled.solve()
    expect(standard.solved).toBe(true)
    expect(disabled.solved).toBe(true)
    expect(disabled.getOutput()).toEqual(standard.getOutput())
    expect(disabled.iterations).toBe(standard.iterations)
    expect(disabled.MAX_ITERATIONS).toBe(standard.MAX_ITERATIONS)
    expect(disabled.stats).toEqual(standard.stats)
  }
})
