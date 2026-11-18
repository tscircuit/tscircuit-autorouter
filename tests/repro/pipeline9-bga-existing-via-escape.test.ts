import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import inputJson from "../../fixtures/bug-reports/bga-existing-via-escape/bga-existing-via-escape.srj.json"

test("repro: a BGA escape adds a via beside its existing via-in-pad", async (): Promise<void> => {
  const input = structuredClone(inputJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  // Current behavior: two new vias, in addition to the declared in-pad via.
  expect(
    routedTraces[0]!.route.filter((point) => point.route_type === "via"),
  ).toHaveLength(2)
  // Use the same 0.2 mm via-to-pad evaluation as the Core regression.
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
      drcOptions: { viaToPadClearance: 0.2 },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
