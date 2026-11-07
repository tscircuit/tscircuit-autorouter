import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("routes the Glider DDR board with completed data-byte copper", async (): Promise<void> => {
  const fixtureUrl = new URL(
    "../fixtures/assets/glider-ddr-dqs.srj.json.gz",
    import.meta.url,
  )
  const { inputSrj, preloadedConnections, preloadedTraces } = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(fixtureUrl))).toString("utf8"),
  ) as {
    inputSrj: SimpleRouteJson
    preloadedConnections: SimpleRouteJson["connections"]
    preloadedTraces: SimplifiedPcbTrace[]
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  // ADDR1, BA1, CSB and WEB pass beside the memory's circular BGA pads.
  // Their 0.127 mm request is reduced because width selection uses square pads.
  const roundPadTraceWidths = routedTraces
    .filter((trace) =>
      [
        "source_trace_1",
        "source_trace_16",
        "source_trace_22",
        "source_trace_48",
      ].includes(trace.connection_name),
    )
    .map((trace) =>
      Math.min(
        ...trace.route.flatMap((point) =>
          point.route_type === "wire" ? [point.width] : [],
        ),
      ),
    )
  expect(roundPadTraceWidths).toEqual([0.11, 0.11, 0.11, 0.11])

  // Render and check the actual completed bytes alongside the remaining routes.
  // The solver receives the original remaining-phase input without these traces.
  const referenceSrj = {
    ...inputSrj,
    connections: [...preloadedConnections, ...inputSrj.connections],
    traces: preloadedTraces,
  }
  const snapshotInput = {
    inputSrj: referenceSrj,
    srjWithPointPairs: referenceSrj,
    routedTraces,
    // Glider's captured board rules use 0.11 mm copper clearance.
    drcOptions: { traceClearance: 0.11, viaToPadClearance: 0.11 },
  }
  expect(referenceSrj.connections).toHaveLength(49)
  expect(preloadedTraces).toHaveLength(16)
  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
  expect(evaluateRelaxedDrc(snapshotInput).errors).toEqual([])
})
