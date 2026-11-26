import { checkEachPcbPortConnectedToPcbTraces } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { stackSvgsVertically } from "stack-svgs"

type Ddr3Handoff = {
  inputSrj: SimpleRouteJson
  preloadedConnections: SimpleRouteJson["connections"]
}

test("snapshots staged H3 and Zynq DDR3 routing", async (): Promise<void> => {
  const fixture = new URL(
    "../../fixtures/repro/whole-route-ddr3.handoff.json.gz",
    import.meta.url,
  )
  const { cases } = JSON.parse(
    new TextDecoder().decode(Bun.gunzipSync(await Bun.file(fixture).bytes())),
  ) as { cases: Ddr3Handoff[] }

  const snapshots: string[] = []
  for (const { inputSrj, preloadedConnections } of cases) {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(inputSrj),
      { cacheProvider: null },
    )
    solver.solve()
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
    snapshots.push(getBugReportSnapshotSvg(snapshotInput))
  }

  await expect(
    stackSvgsVertically(snapshots, { normalizeSize: false }),
  ).toMatchSvgSnapshot(import.meta.path)
})
