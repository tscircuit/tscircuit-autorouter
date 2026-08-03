import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

const makeViaRoute = (
  connectionName: string,
  x: number,
  duplicateVia = false,
): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: x - 0.5, y: -0.2, z: 0 },
    { x, y: 0, z: 0 },
    { x, y: 0, z: 1 },
    { x: x - 0.5, y: 0.2, z: 1 },
  ],
  vias: duplicateVia
    ? [
        { x, y: 0 },
        { x, y: 0 },
      ]
    : [{ x, y: 0 }],
})

const routeWithDuplicate = makeViaRoute("route-with-duplicate", 0, true)
const nearbyRoute = makeViaRoute("nearby-route", 0.2)

const routeGraphics: GraphicsObject = {
  lines: [
    {
      points: routeWithDuplicate.route.slice(0, 2),
      strokeColor: "#dc2626",
      strokeWidth: routeWithDuplicate.traceThickness,
      label: "duplicate route: z0",
    },
    {
      points: routeWithDuplicate.route.slice(2),
      strokeColor: "#2563eb",
      strokeWidth: routeWithDuplicate.traceThickness,
      label: "duplicate route: z1",
    },
    {
      points: nearbyRoute.route.slice(0, 2),
      strokeColor: "rgba(220, 38, 38, 0.55)",
      strokeWidth: nearbyRoute.traceThickness,
      label: "nearby route: z0",
    },
    {
      points: nearbyRoute.route.slice(2),
      strokeColor: "rgba(37, 99, 235, 0.55)",
      strokeWidth: nearbyRoute.traceThickness,
      label: "nearby route: z1",
    },
  ],
  points: [],
  rects: [],
  circles: [],
}

test("same-net via merger canonicalizes duplicate physical vias before batching", async () => {
  const inputHdRoutes = [routeWithDuplicate, nearbyRoute]
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes,
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({
      net0: inputHdRoutes.map((route) => route.connectionName),
    }),
  })

  expect(solver.vias).toHaveLength(2)

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.getMergedViaHdRoutes()?.flatMap((route) => route.vias)).toEqual(
    [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
  )

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "Before: duplicate site scheduled twice",
          graphics: {
            ...routeGraphics,
            circles: [
              {
                center: { x: 0, y: 0.035 },
                radius: 0.13,
                fill: "rgba(220, 38, 38, 0.38)",
                stroke: "#b91c1c",
                label: "duplicate record A at (0, 0)",
              },
              {
                center: { x: 0, y: -0.035 },
                radius: 0.1,
                fill: "rgba(249, 115, 22, 0.38)",
                stroke: "#c2410c",
                label: "duplicate record B at (0, 0)",
              },
              {
                center: { x: 0.2, y: 0 },
                radius: 0.15,
                fill: "rgba(37, 99, 235, 0.35)",
                stroke: "#1d4ed8",
                label: "nearby keep site",
              },
            ],
            arrows: [
              {
                start: { x: 0, y: 0.035 },
                end: { x: 0.2, y: 0 },
                color: "#f59e0b",
                label: "first scheduled move",
              },
              {
                start: { x: 0, y: -0.035 },
                end: { x: 0.2, y: 0 },
                color: "#dc2626",
                label: "stale duplicate move",
              },
            ],
          },
        },
        {
          name: "After: one candidate per physical site",
          graphics: {
            ...routeGraphics,
            circles: [
              {
                center: { x: 0, y: 0 },
                radius: 0.15,
                fill: "rgba(22, 163, 74, 0.4)",
                stroke: "#15803d",
                label: "canonical transition site",
              },
              {
                center: { x: 0.2, y: 0 },
                radius: 0.15,
                fill: "rgba(37, 99, 235, 0.35)",
                stroke: "#1d4ed8",
                label: "nearby transition site",
              },
            ],
            arrows: [
              {
                start: { x: 0.2, y: 0 },
                end: { x: 0, y: 0 },
                color: "#16a34a",
                label: "single deterministic merge",
              },
            ],
          },
        },
      ],
      columns: 2,
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "duplicate-via-before-after",
  })
})
