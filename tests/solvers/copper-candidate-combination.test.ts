import { expect, test } from "bun:test"
import { CopperCandidateCompatibilitySearch, type CopperRouteCandidate } from "lib/solvers/HighDensitySolver/CopperCandidateCompatibilitySearch"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"

test("physical domains revise two earlier choices rather than reproducing a route ordering", () => {
  const candidate = (id: number, task: number, points: number[][]): CopperRouteCandidate => ({
    id, task, route: {
      connectionName: `net${task}`, regionId: "region", traceThickness: 0.1, viaDiameter: 0.3,
      route: points.map(([x, y]) => ({ x, y, z: 0 })), vias: [],
    },
  })
  const a0 = candidate(0, 0, [[-2, 0], [2, 0]])
  const a1 = candidate(1, 0, [[-2, 0], [-2, 2], [2, 2], [2, 0]])
  const b1 = candidate(2, 1, [[0, -1], [3, -1], [3, 1], [0, 1]])
  const b0 = candidate(3, 1, [[0, -1], [0, 1]])
  const c = candidate(4, 2, [[-1, 2], [1, 2]])
  const conflict = (left: CopperRouteCandidate, right: CopperRouteCandidate): boolean =>
    doPipeline9RoutesHaveCopperConflict({ left: left.route, right: right.route, clearance: 0.1, layerCount: 2 })
  expect(conflict(a1, c)).toBe(true)
  expect(conflict(a0, b0)).toBe(true)
  const search = new CopperCandidateCompatibilitySearch({
    domains: [[a0, a1], [b1, b0], [c]], maxAttempts: 64,
    charge: () => {}, conflict,
  })
  while (search.status === "searching") search.step()
  expect(search.status).toBe("found")
  expect(search.solution?.map((choice) => choice.id)).toEqual([0, 2, 4])
  expect(search.rejected).toBe(2)
  for (let left = 0; left < search.solution!.length; left++)
    for (let right = left + 1; right < search.solution!.length; right++)
      expect(conflict(search.solution![left], search.solution![right])).toBe(false)
})
