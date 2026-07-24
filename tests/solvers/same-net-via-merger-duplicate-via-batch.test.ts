import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const makeViaRoute = ({
  connectionName,
  x,
  duplicateVia = false,
}: {
  connectionName: string
  x: number
  duplicateVia?: boolean
}): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x, y: 0, z: 0 },
    { x, y: 0, z: 1 },
  ],
  vias: duplicateVia
    ? [
        { x, y: 0 },
        { x, y: 0 },
      ]
    : [{ x, y: 0 }],
})

test("SameNetViaMergerSolver canonicalizes route vias before batching merges", () => {
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: [
      makeViaRoute({
        connectionName: "route-with-duplicate",
        x: 0,
        duplicateVia: true,
      }),
      makeViaRoute({ connectionName: "nearby-route", x: 0.1 }),
      {
        connectionName: "route-with-stale-via",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 2, y: 0, z: 0 },
          { x: 3, y: 0, z: 0 },
        ],
        vias: [{ x: 2.5, y: 0 }],
      },
      {
        connectionName: "through-obstacle-route",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          {
            x: 4,
            y: 0,
            z: 0,
            toNextSegmentType: "through_obstacle",
          },
          { x: 5, y: 0, z: 1 },
        ],
        vias: [{ x: 4.5, y: 0 }],
      },
      {
        connectionName: "combined-transition-at-start",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 6, y: 0, z: 0 },
          { x: 7, y: 0, z: 1 },
        ],
        vias: [{ x: 6, y: 0 }],
      },
      {
        connectionName: "combined-transition-at-end",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 8, y: 0, z: 0 },
          { x: 9, y: 0, z: 1 },
        ],
        vias: [{ x: 9, y: 0 }],
      },
    ],
    obstacles: [],
    colorMap: {
      "route-with-duplicate": "#ef4444",
      "nearby-route": "#3b82f6",
      "route-with-stale-via": "#22c55e",
      "through-obstacle-route": "#f97316",
      "combined-transition-at-start": "#a855f7",
      "combined-transition-at-end": "#06b6d4",
    },
    layerCount: 2,
    connMap: new ConnectivityMap({
      net0: [
        "route-with-duplicate",
        "nearby-route",
        "route-with-stale-via",
        "through-obstacle-route",
        "combined-transition-at-start",
        "combined-transition-at-end",
      ],
    }),
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.getMergedViaHdRoutes()?.flatMap((route) => route.vias)).toEqual(
    [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 9, y: 0 },
    ],
  )
  expect(
    solver
      .getMergedViaHdRoutes()
      ?.find((route) => route.connectionName === "combined-transition-at-start")
      ?.route,
  ).toEqual([
    { x: 6, y: 0, z: 0 },
    { x: 6, y: 0, z: 1 },
    { x: 7, y: 0, z: 1 },
  ])
  expect(
    solver
      .getMergedViaHdRoutes()
      ?.find((route) => route.connectionName === "combined-transition-at-end")
      ?.route,
  ).toEqual([
    { x: 8, y: 0, z: 0 },
    { x: 9, y: 0, z: 0 },
    { x: 9, y: 0, z: 1 },
  ])
  expect(solver.viaMerges).toEqual([
    {
      connectionName: "nearby-route",
      from: { x: 0.1, y: 0 },
      to: { x: 0, y: 0 },
    },
  ])

  const graphics = solver.visualize()
  const visualizedSteps = new Set([
    ...(graphics.lines ?? []).map((line) => line.step),
    ...(graphics.circles ?? []).map((circle) => circle.step),
  ])
  expect(visualizedSteps).toEqual(new Set([1, 2, 3]))
  expect(
    graphics.lines?.some(
      (line) => line.step === 3 && line.label === "Via merge movement",
    ),
  ).toBe(true)
})
