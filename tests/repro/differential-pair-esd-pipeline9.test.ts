import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("Pipeline9 rejects same-net copper that bypasses the owned ESD itinerary", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  expect(() => solver.solve()).toThrow("ownership violation")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  for (const connection of srj.connections.filter(
    (connection): boolean => connection.name !== "tap",
  )) {
    expect(solver.netToPointPairsSolver!.newConnections).toContainEqual(
      connection,
    )
  }
  expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow("before solving")
})
