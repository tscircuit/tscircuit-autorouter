import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("H3 stops retrying an exhausted strobe search", (): void => {
  const compressed = readFileSync(
    new URL(
      "../../fixtures/features/h3-single-route-exhaustion/input.srj.json.gz",
      import.meta.url,
    ),
  )
  const inputSrj: SimpleRouteJson = JSON.parse(
    gunzipSync(new Uint8Array(compressed)).toString("utf8"),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.failed).toBe(true)
  expect(solver.portPointPathingSolver?.stats.duplicateCongestedPortError).toBe(
    "Route 10 could not be solved independently: No path for source_trace_46",
  )
})
