import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("routes the remaining A13 DDR nets after the four data bytes", async (): Promise<void> => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/a13-ddr-surface-routing/input.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  expect(input.obstacles).toHaveLength(378)
  expect(input.traces?.filter((trace) => trace.isFixed)).toHaveLength(32)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)

  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const pointPairs = solver.srjWithPointPairs!.connections
  expect(routedTraces).toHaveLength(64)
  expect(new Set(routedTraces.map((trace) => trace.connection_name))).toEqual(
    new Set(pointPairs.map((pair) => pair.name)),
  )
  const fixedTraces = solver.getOutputSimpleRouteJson().traces?.filter(
    (trace) => trace.isFixed,
  )
  expect(fixedTraces).toEqual(input.traces)
  const wireLayers = new Set(
    routedTraces.flatMap((trace) =>
      trace.route.flatMap((point) =>
        point.route_type === "wire" ? [point.layer] : [],
      ),
    ),
  )
  // The source board reserves both inner layers for planes.
  expect(wireLayers).toEqual(new Set(["top", "bottom"]))
  const snapshotInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
    drcOptions: {
      traceClearance: input.minTraceToPadEdgeClearance,
      viaToPadClearance: input.minViaEdgeToPadEdgeClearance,
      viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
      holeClearance: input.minTraceToHoleEdgeClearance,
    },
  }
  const checkCopper = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    drcOptions: snapshotInput.drcOptions,
    includeBoardClearance: true,
    clearanceTolerance: 1e-9,
  })
  expect(checkCopper(routedTraces).errors).toEqual([])
  await expect(
    getBugReportSnapshotSvg(snapshotInput, { showErrorLocations: true }),
  ).toMatchSvgSnapshot(import.meta.path)
})
