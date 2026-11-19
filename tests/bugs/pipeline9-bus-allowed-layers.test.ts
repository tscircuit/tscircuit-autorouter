import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import capturedSrj from "../../fixtures/bug-reports/pipeline9-bus-allowed-layers/input.srj.json"

test("Pipeline 9 ignores the allowed layer for a two-connection bus", async (): Promise<void> => {
  const input = structuredClone(capturedSrj as SimpleRouteJson)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(2)
  const routePoints = traces.flatMap((trace) => trace.route)
  expect(routePoints.filter((point) => point.route_type === "via")).toHaveLength(0)
  expect(
    new Set(
      routePoints
        .filter((point) => point.route_type === "wire")
        .map((point) => point.layer),
    ),
  ).toEqual(new Set(["top"]))

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
