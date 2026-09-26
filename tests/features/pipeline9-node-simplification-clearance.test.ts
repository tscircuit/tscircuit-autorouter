import { expect, test } from "bun:test"
import { createNodeSimplification, createShortcutRoute } from "tests/fixtures/node-simplification"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"

test("node simplification retains detours and their configured copper clearance", () => {
  const blocker = {
    ...createShortcutRoute(),
    connectionName: "b",
    route: [{ x: -2, y: -0.35, z: 0 }, { x: 2, y: -0.35, z: 0 }],
  }
  const solver = createNodeSimplification({ routes: [createShortcutRoute(), blocker] })
  solver.solve()
  const [left, right] = solver.getOutput()
  expect(left!.route.length).toBeGreaterThan(2)
  expect(doPipeline9RoutesHaveCopperConflict({ left: left!, right: right!, clearance: 0.2 })).toBeFalse()
})
