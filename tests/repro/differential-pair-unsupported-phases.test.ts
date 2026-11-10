import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("partial selections and hops split across routing groups are unsupported", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro(7)
  srj.connections[0]!.routingPcbGroupId = "completed-child-phase"
  expect(() => new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)).toThrow(
    "multiple routing groups/phases",
  )
  srj.connections = srj.connections.filter(
    (connection): boolean => connection.name !== "P:0",
  )
  expect(() => new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)).toThrow(
    "exactly one connection in this routing phase",
  )
})
