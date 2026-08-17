import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport91-1046bd/bugreport91-1046bd.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport91 routes every connector escape end-to-end", () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const portPointPathingSolver = solver.portPointPathingSolver
  expect(portPointPathingSolver).toBeDefined()
  expect(portPointPathingSolver?.failed).toBe(false)
  expect(portPointPathingSolver?.solved).toBe(true)
  expect(
    portPointPathingSolver?.stats.duplicateCongestedPortFallbackToOriginal,
  ).toBe(false)
  const routedConnectionNames = new Set(
    solver._getOutputHdRoutes().map((route) => route.connectionName),
  )
  expect(
    solver.netToPointPairsSolver?.newConnections.every((connection) =>
      routedConnectionNames.has(connection.name),
    ),
  ).toBe(true)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
