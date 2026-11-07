import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UselessViaRemovalSolver } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("replacing a route keeps same-name fixed copper in later clearance checks", () => {
  const editable: HighDensityRoute = {
    connectionName: "shared",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 5, z: 0 },
      { x: 1, y: 5, z: 0 },
    ],
    vias: [],
  }
  const fixed: HighDensityRoute = {
    ...editable,
    route: [
      { x: 10, y: -1, z: 0 },
      { x: 10, y: 1, z: 0 },
    ],
  }
  const detour: HighDensityRoute = {
    ...editable,
    connectionName: "detour",
    route: [
      { x: 8, y: 0, z: 0 },
      { x: 9, y: 0, z: 0 },
      { x: 9, y: 0, z: 1 },
      { x: 11, y: 0, z: 1 },
      { x: 11, y: 0, z: 0 },
      { x: 12, y: 0, z: 0 },
    ],
    vias: [
      { x: 9, y: 0 },
      { x: 11, y: 0 },
    ],
  }
  const fixedBefore = structuredClone(fixed)
  const solver = new UselessViaRemovalSolver({
    unsimplifiedHdRoutes: [editable, detour],
    otherHdRoutes: [fixed],
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({ shared: ["shared"], detour: ["detour"] }),
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOptimizedHdRoutes()?.[1].vias).toEqual(detour.vias)
  expect(fixed).toEqual(fixedBefore)
  expect(
    solver.hdRouteSHI!
      .getConflictingRoutesNearPoint({ x: 10, y: 0, z: 0 }, 0.1)
      .map(({ conflictingRoute }) => conflictingRoute),
  ).toEqual([fixed])
})
