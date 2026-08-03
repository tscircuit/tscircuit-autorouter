import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

const transitionRoute: HighDensityRoute = {
  connectionName: "transition-route",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: -0.6, y: -0.25, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: -0.6, y: 0.25, z: 1 },
  ],
  vias: [{ x: 0, y: 0 }],
}

const metadataOnlyRoute: HighDensityRoute = {
  connectionName: "metadata-only-route",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: 0.1, y: -0.1, z: 0 },
    { x: 0.8, y: -0.1, z: 0 },
  ],
  vias: [{ x: 0.2, y: 0 }],
}

const routeGraphics: GraphicsObject = {
  lines: [
    {
      points: transitionRoute.route.slice(0, 2),
      strokeColor: "#dc2626",
      strokeWidth: transitionRoute.traceThickness,
      label: "real route: z0",
    },
    {
      points: transitionRoute.route.slice(2),
      strokeColor: "#2563eb",
      strokeWidth: transitionRoute.traceThickness,
      label: "real route: z1",
    },
    {
      points: metadataOnlyRoute.route,
      strokeColor: "#64748b",
      strokeWidth: metadataOnlyRoute.traceThickness,
      label: "single-layer route",
    },
  ],
  points: [],
  rects: [],
  circles: [],
}

test("same-net via merger indexes only route-backed layer transitions", async () => {
  const inputHdRoutes = [transitionRoute, metadataOnlyRoute]
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes,
    obstacles: [],
    colorMap: {
      "transition-route": "#16a34a",
      "metadata-only-route": "#64748b",
    },
    layerCount: 2,
    connMap: new ConnectivityMap({
      net0: inputHdRoutes.map((route) => route.connectionName),
    }),
  })

  expect(solver.vias).toHaveLength(1)
  expect(solver.vias[0]).toMatchObject({ x: 0, y: 0, layers: [0, 1] })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.getMergedViaHdRoutes()).toEqual(inputHdRoutes)

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "Before: metadata treated as a movable via",
          graphics: {
            ...routeGraphics,
            circles: [
              {
                center: { x: 0, y: 0 },
                radius: 0.15,
                fill: "rgba(22, 163, 74, 0.45)",
                stroke: "#15803d",
                label: "real vertical transition",
              },
              {
                center: { x: 0.2, y: 0 },
                radius: 0.15,
                fill: "rgba(220, 38, 38, 0.45)",
                stroke: "#b91c1c",
                label: "metadata only: no layer transition",
              },
            ],
            arrows: [
              {
                start: { x: 0.2, y: 0 },
                end: { x: 0, y: 0 },
                color: "#f59e0b",
                label: "invalid merge attempt",
              },
            ],
          },
        },
        {
          name: "After: index contains real transitions only",
          graphics: {
            ...routeGraphics,
            circles: [
              {
                center: { x: 0, y: 0 },
                radius: 0.15,
                fill: "rgba(22, 163, 74, 0.45)",
                stroke: "#15803d",
                label: "indexed vertical transition",
              },
              {
                center: { x: 0.2, y: 0 },
                radius: 0.08,
                fill: "rgba(100, 116, 139, 0.18)",
                stroke: "#64748b",
                label: "metadata retained but excluded from candidates",
              },
            ],
          },
        },
      ],
      columns: 2,
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "metadata-only-via-before-after",
  })
})
