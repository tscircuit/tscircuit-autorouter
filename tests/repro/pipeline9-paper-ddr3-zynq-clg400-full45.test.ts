import { checkEachPcbPortConnectedToPcbTraces } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("routes Zynq CLG400 DDR3 beside both completed data bytes", async (): Promise<void> => {
  const fixtureUrl = new URL(
    "../../fixtures/repro/whole-route-ddr3.handoff.json.gz",
    import.meta.url,
  )
  const { cases } = JSON.parse(
    new TextDecoder().decode(Bun.gunzipSync(await Bun.file(fixtureUrl).bytes())),
  ) as {
    cases: {
      case: string
      inputSrj: SimpleRouteJson
      preloadedConnections: SimpleRouteJson["connections"]
    }[]
  }
  const handoff = cases.find((entry) => entry.case === "zynq-clg400-full45")
  if (!handoff) throw new Error("Missing zynq-clg400-full45 handoff")
  const { inputSrj, preloadedConnections } = handoff
  expect(preloadedConnections).toHaveLength(16)
  expect(inputSrj.connections).toHaveLength(29)
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
  const { circuitJson, errors } = evaluateRelaxedDrc(snapshotInput)
  expect([...errors, ...checkEachPcbPortConnectedToPcbTraces(circuitJson)]).toEqual(
    [],
  )

  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
