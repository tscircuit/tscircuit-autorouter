import { expect, test } from "bun:test"
import {
  checkEachPcbPortConnectedToPcbTraces,
  checkViasInPads,
} from "@tscircuit/checks"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"

test("A13 repairs require a via-in-pad opt-in", (): void => {
  const fixture: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/a13-no-via-in-pad/input.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  for (const allowViaInPad of [false, undefined, true] as const) {
    const input = { ...structuredClone(fixture), allowViaInPad }
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const traces = solver.getOutputSimplifiedPcbTraces()
    expect(traces).toHaveLength(8)
    const circuitJson = convertToCircuitJson(
      solver.srjWithPointPairs!,
      traces,
      {
        originalSrj: input,
        includeOriginalConnections: true,
        minTraceWidth: input.minTraceWidth,
        minViaDiameter: input.minViaDiameter,
      },
    )
    expect(checkEachPcbPortConnectedToPcbTraces(circuitJson)).toEqual([])
    const forbiddenVias = checkViasInPads(circuitJson)
    if (allowViaInPad === true) {
      expect(forbiddenVias.length).toBeGreaterThan(0)
    } else {
      expect(forbiddenVias).toEqual([])
    }
  }
})
