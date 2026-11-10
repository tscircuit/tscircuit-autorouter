import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

function readA64Srj(filename: string): SimpleRouteJson {
  const compressed = readFileSync(
    new URL(
      `../fixtures/assets/a64-clock-through-via-space/${filename}.srj.json.gz`,
      import.meta.url,
    ),
  )
  return JSON.parse(gunzipSync(new Uint8Array(compressed)).toString("utf8"))
}

test("routes the A64 DDR clock through clear space outside the CPU", async (): Promise<void> => {
  const inputSrj = readA64Srj("input")
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  solver.solve()

  let routedTraces: SimplifiedPcbTrace[] = []
  if (solver.solved) routedTraces = solver.getOutputSimplifiedPcbTraces()
  const referenceSrj = readA64Srj("physical-reference")
  const snapshotInput = {
    inputSrj: referenceSrj,
    srjWithPointPairs: referenceSrj,
    routedTraces,
    drcOptions: { traceClearance: 0.10668, viaToPadClearance: 0.10668 },
  }
  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
  expect(evaluateRelaxedDrc(snapshotInput).errors).toEqual([])
})
