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
): boolean =>
  route.route.some(
    (routePoint) =>
      Math.abs(routePoint.x - point.x) < tolerance &&
      Math.abs(routePoint.y - point.y) < tolerance,
  )

test("bugreport58 keeps the target stitched and renders the final route", () => {
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
  expect(
    routeTouchesPoint(stitchedRoutes[0]!, targetConnection!.pointsToConnect[0]),
  ).toBe(true)
  expect(
    routeTouchesPoint(stitchedRoutes[0]!, targetConnection!.pointsToConnect[1]),
  ).toBe(true)

  solver.solve()
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(snapshotPath)
})
