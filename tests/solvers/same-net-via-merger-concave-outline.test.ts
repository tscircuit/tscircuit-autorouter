import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { doesSegmentCrossPolygonBoundary } from "lib/utils/polygonContainment"

test("via merging retains a route whose relocated segment leaves a concave board", (): void => {
  const outline: Array<{ x: number; y: number }> = [
    { x: -3, y: -3 },
    { x: 3, y: -3 },
    { x: 3, y: 3 },
    { x: -0.7, y: 3 },
    { x: -0.7, y: -0.85 },
    { x: -1, y: -0.85 },
    { x: -1, y: 3 },
    { x: -3, y: 3 },
  ]
  const editable: HighDensityRoute = {
    connectionName: "editable",
    traceThickness: 0.15,
    viaDiameter: 0.6,
    route: [
      { x: -2, y: -2, z: 0 },
      { x: 1.2, y: 0, z: 0 },
      { x: 1.2, y: 0, z: 1 },
      { x: 1.2, y: 1, z: 1 },
    ],
    vias: [{ x: 1.2, y: 0 }],
  }
  const anchor: HighDensityRoute = {
    connectionName: "anchor",
    traceThickness: 0.15,
    viaDiameter: 0.6,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  expect(
    doesSegmentCrossPolygonBoundary({
      start: editable.route[0]!,
      end: editable.route[1]!,
      polygon: outline,
      margin: 0.15 / 2 + 0.2,
    }),
  ).toBeFalse()
  expect(
    doesSegmentCrossPolygonBoundary({
      start: editable.route[0]!,
      end: anchor.route[0]!,
      polygon: outline,
      margin: 0.15 / 2 + 0.2,
    }),
  ).toBeTrue()
  const original: HighDensityRoute[] = structuredClone([editable, anchor])
  const solver: SameNetViaMergerSolver = new SameNetViaMergerSolver({
    inputHdRoutes: [editable],
    otherHdRoutes: [anchor],
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    outline,
    connMap: new ConnectivityMap({ signal: ["editable", "anchor"] }),
  })
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.getMergedViaHdRoutes()).toEqual([editable])
  expect([editable, anchor]).toEqual(original)
})
