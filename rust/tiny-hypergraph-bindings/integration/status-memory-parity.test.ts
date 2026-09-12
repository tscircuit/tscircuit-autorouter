import { expect, test } from "bun:test"
import { initializeTinyHypergraphBindings } from "../../../lib/bindings/initializeTinyHypergraphBindings"
import * as bindings from "../pkg/tiny_hypergraph_bindings.js"
import { TinyHyperGraphSolver } from "../ts/TinyHyperGraphSolver"
import { getTinyHypergraphMemory } from "../ts/loadTinyHypergraphBindings"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "../ts/types"

test("compact status survives memory growth, other solvers and every routing mutation", () => {
  initializeTinyHypergraphBindings()
  const topology: TinyHyperGraphTopology = {
    portCount: 2, regionCount: 3,
    regionIncidentPorts: [[0], [0, 1], [1]], incidentPortRegion: [[1, 0], [1, 2]],
    regionWidth: [1, 2, 1], regionHeight: [1, 2, 1],
    regionCenterX: [-2, 0, 2], regionCenterY: [0, 0, 0],
    regionAvailableZMask: [1, 1, 1],
    portAngleForRegion1: [18000, 0], portAngleForRegion2: [0, 18000],
    portX: [-1, 1], portY: [0, 0], portZ: [0, 0],
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1, portSectionMask: [1, 1], routeStartPort: [0], routeEndPort: [1],
    routeNet: [0], regionNetId: [-1, -1, -1],
  }
  for (const variant of ["base", "outside-in", "selective-rerip"] as const) {
    const options = { MAX_ITERATIONS: 100 }
    const actual = new TinyHyperGraphSolver(topology, problem, options, { variant })
    const expected = new bindings.TinyHyperGraphSolver(topology, problem, options, { variant })
    const other = new TinyHyperGraphSolver(topology, problem, options)
    const compareStatus = (): void => {
      const status = expected.getStatus() as Record<string, unknown>
      expect(actual.getStatus()).toEqual({ ...status, error: status.error ?? null })
      expect(actual.getStatsRevision()).toBe(expected.getStatsRevision())
      expect(actual.getStats()).toEqual(expected.getStats())
      expect(actual.pendingRouteCount).toBe(expected.pendingRouteCount())
      expect(actual.ripCount).toBe(expected.ripCount())
    }
    try {
      compareStatus()
      getTinyHypergraphMemory().grow(1)
      other.solve()
      for (let index = 0; index < 3; index++) {
        const status = expected.step() as Record<string, unknown>
        expect(actual.step()).toEqual({ ...status, error: status.error ?? null })
        compareStatus()
      }
      actual.stepMany(100)
      expected.stepMany(100)
      compareStatus()
      actual.resetRoutingStateForRerip()
      expected.resetRoutingStateForRerip()
      compareStatus()
      getTinyHypergraphMemory().grow(1)
      const solution = { solvedRoutePathSegments: [[[0, 1] as [number, number]]] }
      actual.replaySolution(solution)
      expected.replaySolution(solution)
      compareStatus()
      actual.solve()
      expected.solve()
      compareStatus()
    } finally {
      actual.dispose()
      expected.free()
      other.dispose()
    }
    expect(() => actual.getStatsRevision()).toThrow("disposed")
  }
})
