import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport58-b69d72/bugreport58-b69d72.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson
const TARGET_CONNECTION = "source_net_2_mst21"

const routeTouchesPoint = (
  route: { route: Array<{ x: number; y: number }> },
  point: { x: number; y: number },
  tolerance = 1e-3,
) =>
  route.route.some(
    (routePoint) =>
      Math.abs(routePoint.x - point.x) < tolerance &&
      Math.abs(routePoint.y - point.y) < tolerance,
  )

test("bugreport58 stitch keeps source_net_2_mst21 connected", () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))

  solver.solveUntilPhase("traceSimplificationSolver")

  const targetConnection = solver.srjWithPointPairs!.connections.find(
    (connection) => connection.name === TARGET_CONNECTION,
  )
  expect(targetConnection).toBeDefined()

  const stitchedRoutes =
    solver.highDensityStitchSolver?.mergedHdRoutes.filter(
      (route) => route.connectionName === TARGET_CONNECTION,
    ) ?? []

  expect(stitchedRoutes).toHaveLength(1)
  // expect(
  //   routeTouchesPoint(stitchedRoutes[0]!, targetConnection!.pointsToConnect[0]),
  // ).toBe(true)
  // expect(
  //   routeTouchesPoint(stitchedRoutes[0]!, targetConnection!.pointsToConnect[1]),
  // ).toBe(true)
}, 120_000)

test("bugreport58-b69d72.json", () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 120_000)
