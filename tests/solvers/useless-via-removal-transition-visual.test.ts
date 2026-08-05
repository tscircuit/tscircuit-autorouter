import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const LAYER_COLORS = ["#dc2626", "#2563eb", "#7c3aed"]

function visualizeRouteSideView(route: HighDensityRoute): GraphicsObject {
  const layers = [...new Set(route.route.map((point) => point.z))].sort(
    (a, b) => a - b,
  )
  return {
    lines: [
      ...route.route.slice(1).map((point, index) => {
        const previousPoint = route.route[index]!
        const changesLayer = previousPoint.z !== point.z
        return {
          points: [
            { x: previousPoint.x, y: -previousPoint.z },
            { x: point.x, y: -point.z },
          ],
          strokeColor: changesLayer
            ? "#f59e0b"
            : (LAYER_COLORS[point.z] ?? "#334155"),
          strokeWidth: 0.08,
          label: changesLayer
            ? "route layer transition"
            : `route on z${point.z}`,
        }
      }),
      ...route.vias.map((via) => ({
        points: [
          { x: via.x, y: -layers[0]! },
          { x: via.x, y: -layers[layers.length - 1]! },
        ],
        strokeColor: "#16a34a",
        strokeWidth: 0.05,
        strokeDash: "0.12 0.08",
        label: `physical via at x=${via.x}`,
      })),
    ],
    points: route.route.map((point) => ({
      x: point.x,
      y: -point.z,
      color: LAYER_COLORS[point.z] ?? "#334155",
      label: `route point (${point.x}, ${point.y}, z${point.z})`,
    })),
    texts: layers.map((z) => ({
      x: -0.25,
      y: -z,
      text: `z${z}`,
      anchorSide: "center_right" as const,
      fontSize: 0.16,
      color: "#0f172a",
    })),
  }
}

function hasRouteTransitionAtVia(route: HighDensityRoute): boolean {
  return route.vias.every((via) =>
    route.route.some(
      (point, index, points) =>
        point.x === via.x &&
        point.y === via.y &&
        points[index + 1]?.x === via.x &&
        points[index + 1]?.y === via.y &&
        point.z !== points[index + 1]?.z,
    ),
  )
}

test("visualizes the physical transition after useless via removal", async (): Promise<void> => {
  const route: HighDensityRoute = {
    connectionName: "multilayer-net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
      { x: 2, y: 0, z: 2 },
      { x: 3, y: 0, z: 2 },
    ],
    vias: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
  }
  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({ net0: [route.connectionName] }),
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  const optimizedRoute = solver.getOptimizedHdRoute()
  const hasPhysicalTransition = hasRouteTransitionAtVia(optimizedRoute)
  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "Input: two physical via transitions",
          graphics: visualizeRouteSideView(route),
        },
        {
          name: hasPhysicalTransition
            ? "Fix: simplified route still meets its via"
            : "Issue: simplified route misses its via",
          graphics: visualizeRouteSideView(optimizedRoute),
        },
      ],
      columns: 2,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
