import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("routes iCEPi DDR signals beside completed data-byte vias", async (): Promise<void> => {
  const fixtureUrl = new URL(
    "../fixtures/assets/icepi-retained-vias/input.srj.json.gz",
    import.meta.url,
  )
  const { inputSrj, referenceSrj } = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(fixtureUrl))).toString("utf8"),
  ) as { inputSrj: SimpleRouteJson; referenceSrj: SimpleRouteJson }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()

  const snapshotInput = {
    inputSrj: referenceSrj,
    srjWithPointPairs: referenceSrj,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    // Keep the board's copper clearance and captured drill clearances.
    drcOptions: {
      traceClearance: 0.1,
      viaToPadClearance: 0.1,
      viaClearance: inputSrj.minViaHoleEdgeToViaHoleEdgeClearance,
      holeClearance: inputSrj.minTraceToHoleEdgeClearance,
    },
  }
  // Preserve or reduce the captured board's existing physical findings.
  expect(evaluateRelaxedDrc(snapshotInput).errors.length).toBeLessThanOrEqual(
    14,
  )
  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
