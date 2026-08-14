import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const makeViaRoute = ({
  connectionName,
  viaX,
  transitionX = viaX,
}: {
  connectionName: string
  viaX: number
  transitionX?: number
}): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: transitionX - 0.5, y: 0, z: 0 },
    { x: transitionX, y: 0, z: 0 },
    { x: transitionX, y: 0, z: 1 },
    { x: transitionX + 0.5, y: 0, z: 1 },
  ],
  vias: [{ x: viaX, y: 0 }],
})

test("preloaded via merging tolerates serialized transition drift", () => {
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: [
      makeViaRoute({ connectionName: "route-a", viaX: 0 }),
      makeViaRoute({
        connectionName: "preloaded-route-b",
        viaX: 0.4,
        transitionX: 0.4004,
      }),
    ],
    obstacles: [],
    colorMap: {
      "route-a": "#ef4444",
      "preloaded-route-b": "#3b82f6",
    },
    layerCount: 2,
    connMap: new ConnectivityMap({
      net0: ["route-a", "preloaded-route-b"],
    }),
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  const routes = solver.getMergedViaHdRoutes()
  expect(routes?.[1]?.vias).toEqual([{ x: 0, y: 0 }])
  expect(
    routes?.[1]?.route.filter(
      (point, pointIndex) =>
        pointIndex > 0 && point.z !== routes[1]!.route[pointIndex - 1]!.z,
    ),
  ).toEqual([{ x: 0, y: 0, z: 1 }])
  const graphics = solver.visualize()
  graphics.texts = [
    ...(graphics.texts ?? []),
    {
      x: -0.45,
      y: 0.42,
      text: "FIXED • preloaded transition follows merged via",
      fontSize: 0.06,
      color: "#111827",
      anchorSide: "center_left",
    },
    {
      x: -0.45,
      y: 0.31,
      text: "transition moved from x=0.4004 to x=0.0000",
      fontSize: 0.05,
      color: "#166534",
      anchorSide: "center_left",
    },
  ]
  expect(graphics).toMatchGraphicsSvg(import.meta.path)
})
