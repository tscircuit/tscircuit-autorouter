import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { scopedClearanceFixture } from "./fixtures/scoped-clearance"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"

test("Pipeline9 cannot publish final expanded copper that violates a scoped rule", () => {
  // Exercise the final acceptance boundary with explicit post-expansion geometry.
  // This test does not claim a fresh full routing solve.
  for (const layer of ["top", "inner1"] as const) {
    const { srj, traces } = scopedClearanceFixture(layer)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
    solver.srjWithPointPairs = srj
    solver.currentPipelineStepIndex = solver.pipelineDef.length
    const expansionInput = { ...srj, fixedTraces: [], traces }
    solver.powerTraceExpansionSolver = new PowerTraceExpansionSolver(
      expansionInput,
      { onlyConnectionNames: [] },
    )
    solver.step()
    expect(solver.solved).toBe(layer === "inner1")
    expect(solver.failed).toBe(layer === "top")
    if (layer === "top") {
      expect(solver.error).toContain("EARTH outer")
      expect(() => solver.getOutputSimpleRouteJson()).toThrow(
        "Cannot get output before solving is complete",
      )
    }
  }
})
