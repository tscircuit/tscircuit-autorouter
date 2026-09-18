import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport106-347963/bugreport106-347963.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport106-347963.json", async () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const wireWidths = routedTraces.flatMap((trace) =>
    trace.route.flatMap((point) =>
      point.route_type === "wire" ? [point.width] : [],
    ),
  )
  expect(Math.min(...wireWidths)).toBeLessThan(0.081)
  expect(Math.min(...wireWidths)).toBeLessThan(srj.minTraceWidth)
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
}, 60_000)
