import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("both routers expose solved traces or a structured generic failure through getResult", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro(7)
  for (const Pipeline of [
    AutoroutingPipelineSolver7_MultiGraph,
    AutoroutingPipelineSolver9_PreloadedTraceGraph,
  ]) {
    const solved = new Pipeline(srj, { cacheProvider: null })
    expect(() => solved.getResult()).toThrow("before completion")
    solved.solve()
    expect(solved.getResult()).toEqual({
      status: "solved",
      traces: solved.getOutputSimplifiedPcbTraces(),
    })
    expect(solved.routingFailure).toBeNull()
    const limited = new Pipeline(srj, { cacheProvider: null })
    limited.MAX_ITERATIONS = 0
    limited.solve()
    expect(limited.getResult()).toEqual({
      status: "failed",
      failure: {
        reason: "routing_failed",
        message: expect.stringContaining("MAX_ITERATIONS=0"),
      },
    })
  }
})
