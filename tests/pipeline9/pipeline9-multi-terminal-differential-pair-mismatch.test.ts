import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { multiTerminalDifferentialPair } from "../fixtures/multiTerminalDifferentialPair"

test("Pipeline9 rejects a three-terminal member paired with a two-terminal member", (): void => {
  const srj = structuredClone(multiTerminalDifferentialPair)
  srj.connections[1]!.pointsToConnect.splice(1, 1)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })

  expect((): void => solver.solve()).toThrow(
    "Pipeline9: differential pair USB_P/USB_N must decompose into the same non-zero number of corresponding segments, got 2 and 1",
  )
})
