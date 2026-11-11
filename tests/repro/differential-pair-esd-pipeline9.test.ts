import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { assertDifferentialPairOutput } from "lib/utils/assertDifferentialPairOutput"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("Pipeline9 routes a returning ESD itinerary without sharing same-lane copper", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(() => assertDifferentialPairOutput(srj, traces)).not.toThrow()
  expect(solver.getResult()).toEqual({
    status: "solved",
    traces,
  })
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  for (const connection of srj.connections.filter(
    (connection): boolean => connection.name !== "tap",
  )) {
    expect(solver.netToPointPairsSolver!.newConnections).toContainEqual({
      ...connection,
      __rootConnectionNames: [connection.name],
    })
  }
  expect(traces).toHaveLength(srj.connections.length)
})
