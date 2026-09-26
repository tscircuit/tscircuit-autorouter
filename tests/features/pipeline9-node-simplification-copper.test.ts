import { expect, test } from "bun:test"
import { createNodeSimplification, createShortcutRoute } from "tests/fixtures/node-simplification"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"

test("node-local shortcuts preserve configured trace and via clearance", () => {
  const blocker = { ...createShortcutRoute(), connectionName: "b", route: [{ x: 0, y: -2, z: 0 }, { x: 0, y: 1, z: 0 }], vias: [] }
  const solver = createNodeSimplification({ routes: [createShortcutRoute(), blocker] })
  solver.solve()
  const [left, right] = solver.getOutput()
  expect(doPipeline9RoutesHaveCopperConflict({ left: left!, right: right!, clearance: 0.2 })).toBeFalse()
  expect(left!.route.length).toBeGreaterThan(2)
})
