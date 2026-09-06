import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 repairs rotated copper and local pad clearances", async (): Promise<void> => {
  for (const sample of [3, 10]) {
    const { scenario } = await loadScenarioBySampleNumber("srj18", sample)
    const input: SimpleRouteJson = structuredClone(scenario)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
      effort: 1,
    })
    solver.solve()

    expect(solver.error).toBeNull()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    if (!solver.srjWithPointPairs) {
      throw new Error("Pipeline9 did not produce point-pair connections")
    }
    const { errors } = evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
      drcOptions: { includeTraceContinuity: true },
    })
    expect(errors).toEqual([])
  }
})
