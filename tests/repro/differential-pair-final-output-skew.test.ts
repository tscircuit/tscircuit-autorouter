import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("both pipelines remeasure emitted copper after power expansion", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro(7)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()
  const traces = structuredClone(solver.getOutputSimplifiedPcbTraces())
  const hop = traces.find((trace): boolean => trace.connection_name === "P:0")!
  const start = hop.route[0]!
  if (start.route_type !== "wire") throw new Error("Expected a wire endpoint")
  hop.route.splice(1, 0, { ...start, y: start.y + 1 })
  const step = solver.pipelineDef.find(
    (step): boolean => step.solverName === "powerTraceExpansionSolver",
  )!
  expect(() =>
    step.onSolved!({
      ...solver,
      powerTraceExpansionSolver: { getOutput: () => traces },
    } as any),
  ).toThrow("exceeds maxLengthSkewMm")
})
