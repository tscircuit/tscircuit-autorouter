import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { expect, test } from "bun:test"
import "bun-match-svg"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { getA64Byte0DrillPadOverlaps } from "tests/fixtures/getA64Byte0DrillPadOverlaps"
import { getEndpointConnectivity } from "tests/fixtures/real-ddr-orangecrab/getEndpointConnectivity"

test("routes every original DDR terminal on the real six-layer OrangeCrab board", async (): Promise<void> => {
  const inputSrj: SimpleRouteJson = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../fixtures/real-ddr-orangecrab/input.srj.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  const original = structuredClone(inputSrj)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    effort: 1,
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(inputSrj).toEqual(original)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const connectivity = getEndpointConnectivity(original, routedTraces)
  expect(connectivity).toEqual({
    connectedNets: 50,
    connectedEndpoints: 102,
  })
  const drc = evaluateRelaxedDrc({
    inputSrj: original,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
    includeBoardClearance: true,
    drcOptions: {
      traceClearance: original.minTraceToPadEdgeClearance,
      viaClearance: original.minViaHoleEdgeToViaHoleEdgeClearance,
      holeClearance: original.minTraceToHoleEdgeClearance,
    },
  })
  const drillOverlaps = getA64Byte0DrillPadOverlaps({
    inputSrj: original,
    routedTraces,
  })
  expect({
    ...connectivity,
    drcErrors: drc.errors.length,
    drillPadOverlaps: drillOverlaps.length,
  }).toMatchSnapshot()
  await expect(
    convertCircuitJsonToPcbSvg(drc.circuitJson, {
      backgroundColor: "white",
      width: 1400,
      height: 900,
      matchBoardAspectRatio: true,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
