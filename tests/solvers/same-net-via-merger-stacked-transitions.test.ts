import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("same-net via batches move repeated transition clusters once", (): void => {
  const stackedRoute: HighDensityRoute = {
    connectionName: "stacked",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0.25, y: -1, z: 0, pcb_port_id: "start" },
      { x: 0.25, y: 0, z: 0 },
      { x: 0.25, y: 0, z: 1 },
      { x: 0.25, y: 0, z: 2 },
      { x: 0.25, y: 1, z: 2, pcb_port_id: "end" },
    ],
    vias: [
      { x: 0.25, y: 0 },
      { x: 0.25, y: 0 },
    ],
  }
  const immutableAnchor: HighDensityRoute = {
    connectionName: "anchor",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const stackedOriginal: HighDensityRoute[] = structuredClone([
    stackedRoute,
    immutableAnchor,
  ])
  const stackedSolver: SameNetViaMergerSolver = new SameNetViaMergerSolver({
    inputHdRoutes: [stackedRoute],
    otherHdRoutes: [immutableAnchor],
    obstacles: [],
    colorMap: {},
    layerCount: 3,
    connMap: new ConnectivityMap({ signal: ["stacked", "anchor"] }),
  })
  stackedSolver.solve()
  expect(stackedSolver.solved).toBeTrue()
  expect(stackedSolver.failed).toBeFalse()
  expect(stackedSolver.getMergedViaHdRoutes()).toEqual([
    {
      ...stackedRoute,
      route: [
        stackedRoute.route[0]!,
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: 2 },
        stackedRoute.route[4]!,
      ],
      vias: [],
    },
  ])
  expect([stackedRoute, immutableAnchor]).toEqual(stackedOriginal)
  expect(stackedSolver.stats.mergedViaCount).toBe(1)

  const repeatedRoute: HighDensityRoute = {
    connectionName: "repeated",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0.25, y: -1, z: 0 },
      { x: 0.25, y: 0, z: 0 },
      { x: 0.25, y: 0, z: 1 },
      { x: 0.25, y: 0, z: 0 },
      { x: 0.25, y: 1, z: 0 },
    ],
    vias: [
      { x: 0.25, y: 0 },
      { x: 0.25, y: 0 },
    ],
  }
  const mutableAnchor: HighDensityRoute = {
    ...immutableAnchor,
    connectionName: "mutable-anchor",
  }
  const repeatedOriginal: HighDensityRoute[] = structuredClone([
    mutableAnchor,
    repeatedRoute,
  ])
  const repeatedSolver: SameNetViaMergerSolver = new SameNetViaMergerSolver({
    inputHdRoutes: [mutableAnchor, repeatedRoute],
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({
      signal: ["mutable-anchor", "repeated"],
    }),
  })
  repeatedSolver.solve()
  expect(repeatedSolver.solved).toBeTrue()
  expect(repeatedSolver.failed).toBeFalse()
  expect(repeatedSolver.getMergedViaHdRoutes()).toEqual([
    mutableAnchor,
    {
      ...repeatedRoute,
      route: [
        repeatedRoute.route[0]!,
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: 0 },
        repeatedRoute.route[4]!,
      ],
      vias: [{ x: 0, y: 0 }],
    },
  ])
  expect([mutableAnchor, repeatedRoute]).toEqual(repeatedOriginal)
  expect(repeatedSolver.stats.mergedViaCount).toBe(1)
})
