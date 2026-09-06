import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("via merging measures foreign via copper independently of its trace width", (): void => {
  const editable: HighDensityRoute = {
    connectionName: "editable",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: -1, z: 0 },
      { x: 0.6, y: 0, z: 0 },
      { x: 0.6, y: 0, z: 1 },
      { x: 0.6, y: 1, z: 1 },
    ],
    vias: [{ x: 0.6, y: 0 }],
  }
  const anchor: HighDensityRoute = {
    connectionName: "anchor", traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
    vias: [{ x: 0, y: 0 }],
  }
  const foreign: HighDensityRoute = {
    connectionName: "foreign", traceThickness: 1e-9, viaDiameter: 0.2,
    route: [{ x: -0.58, y: -0.35, z: 0 }, { x: -0.58, y: -0.35, z: 1 }],
    vias: [{ x: -0.58, y: -0.35 }],
  }
  expect(
    pointToSegmentDistance(foreign.vias[0]!, editable.route[0]!, editable.route[1]!),
  ).toBeGreaterThan(0.15 / 2 + 0.2 / 2 + 0.1)
  const input: HighDensityRoute[] = structuredClone([editable, anchor, foreign])
  const solver: SameNetViaMergerSolver = new SameNetViaMergerSolver({
    inputHdRoutes: [editable], otherHdRoutes: [anchor, foreign],
    obstacles: [], colorMap: {}, layerCount: 2,
    connMap: new ConnectivityMap({ signal: ["editable", "anchor"], other: ["foreign"] }),
  })
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.getMergedViaHdRoutes()).toEqual([editable])
  expect([editable, anchor, foreign]).toEqual(input)
})
