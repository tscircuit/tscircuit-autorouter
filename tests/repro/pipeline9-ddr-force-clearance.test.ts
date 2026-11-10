import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { loadDdrForceClearanceFixture } from "../fixtures/loadDdrForceClearanceFixture"

test("DDR routing beside completed data-byte copper", async (): Promise<void> => {
  const fixture = loadDdrForceClearanceFixture()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.inputSrj,
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()

  const referenceSrj = {
    ...fixture.inputSrj,
    obstacles: fixture.nativeObstacles,
    connections: [
      ...fixture.preloadedConnections,
      ...fixture.inputSrj.connections,
    ],
    traces: fixture.preloadedTraces,
  }
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: referenceSrj,
      srjWithPointPairs: {
        ...solver.srjWithPointPairs!,
        connections: [
          ...fixture.preloadedConnections,
          ...solver.srjWithPointPairs!.connections,
        ],
      },
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
      // Preserve the captured board's copper-clearance rules.
      drcOptions: {
        traceClearance: 0.089,
        viaToPadClearance: fixture.inputSrj.minPadEdgeToPadEdgeClearance,
      },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
