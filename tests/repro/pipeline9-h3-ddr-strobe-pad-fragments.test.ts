import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"

function readH3Srj(filename: string): SimpleRouteJson {
  const compressed = readFileSync(
    new URL(
      `../../fixtures/features/h3-ddr-strobes/${filename}.srj.json.gz`,
      import.meta.url,
    ),
  )
  return JSON.parse(gunzipSync(new Uint8Array(compressed)).toString("utf8"))
}

test("H3 DDR3 DQS0 leaves fragmented terminal pads beside eight fixed data routes", async (): Promise<void> => {
  const inputSrj = readH3Srj("input")
  const routedDataSrj = readH3Srj("routed-data")
  const originalInput = structuredClone(inputSrj)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  solver.solve()

  let routedTraces: SimplifiedPcbTraces = []
  if (solver.solved) routedTraces = solver.getOutputSimplifiedPcbTraces()

  // Check against actual prior copper, not its anonymous obstacle projection.
  const referenceSrj: SimpleRouteJson = {
    ...routedDataSrj,
    connections: [...routedDataSrj.connections, ...inputSrj.connections],
  }
  const snapshotInput = {
    inputSrj: referenceSrj,
    srjWithPointPairs: {
      ...referenceSrj,
      connections: [
        ...routedDataSrj.connections,
        ...solver.srjWithPointPairs!.connections,
      ],
    },
    routedTraces,
    // Preserve this real board's 0.0889 mm clearance.
    drcOptions: { traceClearance: 0.0889, viaToPadClearance: 0.0889 },
  }
  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(routedDataSrj.traces).toHaveLength(8)
  expect(routedTraces).toHaveLength(2)
  expect(evaluateRelaxedDrc(snapshotInput).errors).toEqual([])
  expect(inputSrj).toEqual(originalInput)
})
