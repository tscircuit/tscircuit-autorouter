import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const makeLayeredViaRoute = (
  connectionName: string,
  x: number,
  y: number,
  layers: [number, number],
): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x, y, z: layers[0] },
    { x, y, z: layers[1] },
  ],
  vias: [{ x, y }],
})

test("a via already coalesced at an anchor does not alternate between anchors", async () => {
  const routeNames = [
    "anchor-a-1",
    "anchor-a-2",
    "bridge",
    "anchor-b-1",
    "anchor-b-2",
  ]
  const inputHdRoutes = [
    makeLayeredViaRoute(routeNames[0]!, 0, 0, [0, 1]),
    makeLayeredViaRoute(routeNames[1]!, 0, 0, [0, 1]),
    makeLayeredViaRoute(routeNames[2]!, 0.3, 0.3, [2, 3]),
    makeLayeredViaRoute(routeNames[3]!, 0.6, 0, [0, 1]),
    makeLayeredViaRoute(routeNames[4]!, 0.6, 0, [0, 1]),
  ]
  const obstacle = {
    type: "rect" as const,
    center: { x: 0.3, y: 0.15 },
    width: 1,
    height: 0.7,
    layers: ["top", "inner1"],
    connectedTo: [],
  }
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes,
    obstacles: [obstacle],
    colorMap: Object.fromEntries(routeNames.map((name) => [name, "#9333ea"])),
    layerCount: 4,
    connMap: new ConnectivityMap({ net0: routeNames }),
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.iterations).toBeLessThan(5)
  const outputRoutes = solver.getMergedViaHdRoutes()!
  expect(outputRoutes[2]!.vias).toEqual([{ x: 0, y: 0 }])
  const visualizeVias = (routes: HighDensityRoute[]) => ({
    rects: [
      {
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: "#f1f5f9",
        stroke: "#64748b",
      },
    ],
    circles: routes.flatMap((route) =>
      route.vias.map((via) => ({
        center: via,
        radius: route.viaDiameter / 2,
        fill: route.connectionName === "bridge" ? "#f97316" : "#9333ea",
        stroke: "#4c1d95",
      })),
    ),
  })
  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Input: orange via sits between two shared anchors",
        step: 0,
        graphics: visualizeVias(inputHdRoutes),
      },
      {
        name: "Result: orange via joins one anchor and stays there",
        step: 1,
        iteration: solver.iterations,
        graphics: visualizeVias(outputRoutes),
      },
    ],
    columns: 2,
    cellWidth: 1.2,
    cellHeight: 1,
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
