import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("routes OrangeCrab clock termination branches through partitioned existing copper", () => {
  const inputSrj: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/orangecrab-clock-termination/input.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const snapshotInput = {
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
    drcOptions: {
      traceClearance: 0.089,
      viaToPadClearance: 0.089,
    },
  }
  expect(routedTraces).toHaveLength(4)
  expect(evaluateRelaxedDrc(snapshotInput).errors).toEqual([])
  expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
