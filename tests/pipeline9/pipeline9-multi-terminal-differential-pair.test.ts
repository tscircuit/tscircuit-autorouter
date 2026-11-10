import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { multiTerminalDifferentialPair } from "../fixtures/multiTerminalDifferentialPair"

test("Pipeline9 reproduces the connector/ESD/MCU differential-pair failure", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(multiTerminalDifferentialPair),
    { cacheProvider: null },
  )

  expect((): void => solver.solve()).toThrow(
    'Pipeline9: differential pair connection "USB_P" must resolve to exactly one final point-pair connection, got 2',
  )
  expect(solver.netToPointPairsSolver!.newConnections).toHaveLength(4)
  expect(solver.effortCleanupSolver!.getOutput()).toHaveLength(4)
  await expect(
    getSvgFromGraphicsObject(convertSrjToGraphicsObject({
      ...multiTerminalDifferentialPair,
      traces: solver.getNewTracesBeforePowerExpansion(),
    }, { traceColorMode: "net" }), { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
