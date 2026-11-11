import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { RoutingFailure } from "lib"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("the async host preserves a serialized worker failure instead of replacing it with text", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro(7)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solveUntilPhase("highDensityRouteSolver")
  solver.step()
  const failure: RoutingFailure = {
    reason: "missing_hop_route",
    pairIndex: 0,
    connectionName: "P:1",
  }
  await expect(
    solver.solveAsync({
      executeAsync: async (): Promise<never> => {
        throw JSON.parse(JSON.stringify({ routingFailure: failure }))
      },
    }),
  ).rejects.toBeDefined()
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.routingFailure).toEqual(failure)
  expect(solver.getResult()).toEqual({ status: "failed", failure })
})
