import { checkEachPcbPortConnectedToPcbTraces } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("routes H3 K51 DDR3 beside the terminated clock and completed data bytes", async (): Promise<void> => {
  const fixtureUrl = new URL(
    "../../fixtures/repro/whole-route-ddr3/allwinner-h3-k51.handoff.json.gz",
    import.meta.url,
  )
  const { inputSrj, preloadedConnections } = JSON.parse(
    new TextDecoder().decode(Bun.gunzipSync(await Bun.file(fixtureUrl).bytes())),
  ) as {
    inputSrj: SimpleRouteJson
    preloadedConnections: SimpleRouteJson["connections"]
  }
  expect(preloadedConnections).toHaveLength(17)
  expect(inputSrj.connections).toHaveLength(34)
  expect(inputSrj.differentialPairs).toHaveLength(2)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(inputSrj),
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBeTrue()

  const referenceSrj = {
    ...inputSrj,
    connections: [...preloadedConnections, ...inputSrj.connections],
  }
  const snapshotInput = {
    inputSrj: referenceSrj,
    srjWithPointPairs: referenceSrj,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  const { circuitJson } = evaluateRelaxedDrc(snapshotInput)
  expect(checkEachPcbPortConnectedToPcbTraces(circuitJson)).toEqual([])

  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
