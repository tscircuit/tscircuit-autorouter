import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { assertDifferentialPairOutput } from "lib/utils/assertDifferentialPairOutput"
import { getDifferentialPairUsbRepro } from "../fixtures/getDifferentialPairUsbRepro"

test("USB single-hop matching recognizes terminals after electrical roots are recomputed", async (): Promise<void> => {
  const srj = await getDifferentialPairUsbRepro()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.getResult().status).toBe("solved")
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(2)
  expect(() => assertDifferentialPairOutput(srj, traces)).not.toThrow()
})
