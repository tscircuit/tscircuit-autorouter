import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { multiTerminalDifferentialPair } from "./fixtures/multiTerminalDifferentialPair"

test("Pipeline7 reproduces the connector/ESD/MCU differential-pair failure", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(multiTerminalDifferentialPair),
    { cacheProvider: null },
  )

  expect((): void => solver.solve()).toThrow(
    'Pipeline7: differential pair connection "USB_P" must resolve to exactly one final point-pair connection, got 2',
  )
  expect(solver.netToPointPairsSolver!.newConnections).toHaveLength(4)
  expect(solver.exactGeometryDrcForceImproveSolver!.getOutput()).toHaveLength(4)
})
