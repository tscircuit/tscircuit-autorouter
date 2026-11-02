import { expect, test } from "bun:test"
import {
  checkEachPcbPortConnectedToPcbTraces,
  checkViasInPads,
} from "@tscircuit/checks"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"

test("A13 legal data escapes retain eighteen connected clearance-clean paths", (): void => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/a13-no-via-in-pad/clean-18-paths.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces).toHaveLength(18)
  const circuitJson = convertToCircuitJson(solver.srjWithPointPairs!, routedTraces, {
    originalSrj: input,
    includeOriginalConnections: true,
    minTraceWidth: input.minTraceWidth,
    minViaDiameter: input.minViaDiameter,
  })
  expect(checkEachPcbPortConnectedToPcbTraces(circuitJson)).toEqual([])
  expect(checkViasInPads(circuitJson)).toEqual([])
  expect(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
      drcOptions: { traceClearance: 0.2, viaToPadClearance: 0.2 },
    }).errors,
  ).toEqual([])
})
