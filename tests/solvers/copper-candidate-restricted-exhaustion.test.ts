import { expect, test } from "bun:test"
import { CopperCandidateCompatibilitySearch } from "lib/solvers/HighDensitySolver/CopperCandidateCompatibilitySearch"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"

test("incompatible finite copper domains remain exhausted proposals without claiming geometric UNSAT", () => {
  const domains = [
    [[-1, 0], [1, 0]], [[0, -1], [0, 1]],
  ].map((points, task) => [{
    id: task, task, route: {
      connectionName: `net${task}`, regionId: "region", traceThickness: 0.1, viaDiameter: 0.3,
      route: points.map(([x, y]) => ({ x, y, z: 0 })), vias: [],
    },
  }])
  const search = new CopperCandidateCompatibilitySearch({
    domains, maxAttempts: 16, charge: () => {},
    conflict: (left, right) => doPipeline9RoutesHaveCopperConflict({
      left: left.route, right: right.route, clearance: 0.1, layerCount: 2,
    }),
  })
  while (search.status === "searching") search.step()
  expect(search.status).toBe("exhausted")
  expect(search.solution).toBeUndefined()
  expect(search.rejected).toBe(1)
  expect(() => search.step()).toThrow("Completed copper candidate search")
})
