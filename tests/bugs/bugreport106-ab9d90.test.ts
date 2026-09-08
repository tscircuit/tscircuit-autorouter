import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport106-ab9d90/bugreport106-ab9d90.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport106 Corne keyboard routes without Pipeline 9 DRC errors", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()

  const srjWithPointPairs = solver.srjWithPointPairs
  if (!srjWithPointPairs) {
    throw new Error("Pipeline 9 did not produce point-pair connections")
  }
  expect(
    new Set(solver._getOutputHdRoutes().map((route) => route.connectionName)),
  ).toEqual(
    new Set(srjWithPointPairs.connections.map((connection) => connection.name)),
  )

  const { errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })

  expect(errors).toHaveLength(0)

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: srj,
      srjWithPointPairs,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
