import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport77-07f6a7/bugreport77-07f6a7.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("rejects legacy bugreport77 geometry outside its routing bounds", () => {
  const outsidePointCount = srj.connections
    .flatMap((connection) => connection.pointsToConnect)
    .filter(
      (point) =>
        point.x < srj.bounds.minX ||
        point.x > srj.bounds.maxX ||
        point.y < srj.bounds.minY ||
        point.y > srj.bounds.maxY,
    ).length

  expect(outsidePointCount).toBe(111)

  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toBeTruthy()
})
