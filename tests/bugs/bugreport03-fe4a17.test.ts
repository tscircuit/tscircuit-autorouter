import { expect, test } from "bun:test"
import bugReport from "../../fixtures/bug-reports/bugreport03-fe4a17/bugreport03-fe4a17.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { AutoroutingPipeline1_OriginalUnravel } from "lib/autorouter-pipelines/AutoroutingPipeline1_OriginalUnravel/AutoroutingPipeline1_OriginalUnravel"

const srj = bugReport.simple_route_json as SimpleRouteJson
const ENDPOINT_TOLERANCE = 1e-3

const isSamePoint = (
  a: { x: number; y: number; z?: number },
  b: { x: number; y: number; z?: number },
) =>
  Math.abs(a.x - b.x) <= ENDPOINT_TOLERANCE &&
  Math.abs(a.y - b.y) <= ENDPOINT_TOLERANCE &&
  (a.z === undefined || b.z === undefined || a.z === b.z)

test("bugreport03-fe4a17.json-AutoroutingPipeline1_OriginalUnravel", () => {
  const solver = new AutoroutingPipeline1_OriginalUnravel(srj)
  solver.solve()

  const routesByConnection = new Map(
    (solver.traceSimplificationSolver?.simplifiedHdRoutes ?? []).map(
      (route) => [route.connectionName, route],
    ),
  )

  for (const connection of srj.connections.filter(
    (connection) => connection.pointsToConnect.length === 2,
  )) {
    const route = routesByConnection.get(connection.name)
    expect(route).toBeDefined()

    const firstPoint = route!.route[0]!
    const lastPoint = route!.route[route!.route.length - 1]!
    const [pointA, pointB] = connection.pointsToConnect

    expect(
      (isSamePoint(firstPoint, pointA) && isSamePoint(lastPoint, pointB)) ||
        (isSamePoint(firstPoint, pointB) && isSamePoint(lastPoint, pointA)),
    ).toBe(true)
  }

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
