import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const makeRoute = ({
  connectionName,
  startX,
  endX,
  rootConnectionName = "root",
  startPcbPortId,
  endPcbPortId,
}: {
  connectionName: string
  startX: number
  endX: number
  rootConnectionName?: string
  startPcbPortId?: string
  endPcbPortId?: string
}): HighDensityIntraNodeRoute => ({
  connectionName,
  rootConnectionName,
  route: [
    { x: startX, y: 0, z: 0 },
    { x: endX, y: 0, z: 0 },
  ],
  vias: [],
  traceThickness: 0.1,
  viaDiameter: 0.3,
  startPcbPortId,
  endPcbPortId,
})

const visualizeFragments = (
  routes: HighDensityIntraNodeRoute[],
  terminals: Array<{ x: number; y: number }>,
) => ({
  lines: routes.map((route) => ({
    points: route.route,
    strokeColor: route.connectionName === "mst1" ? "#f97316" : "#2563eb",
    strokeWidth: 0.08,
  })),
  circles: terminals.map((terminal) => ({
    center: terminal,
    radius: 0.1,
    fill: "#dc2626",
    stroke: "#7f1d1d",
  })),
})

test("stitch terminals remain a distinct start/end pair", async () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "route",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "port-start" },
          { x: 0.9, y: 0, layer: "top", pcb_port_id: "port-end" },
        ],
      },
    ],
    hdRoutes: [makeRoute({ connectionName: "route", startX: 0.1, endX: 0.2 })],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })

  expect(solver.unsolvedRoutes).toHaveLength(1)
  expect(solver.unsolvedRoutes[0]!.start.pcb_port_id).toBe("port-start")
  expect(solver.unsolvedRoutes[0]!.end.pcb_port_id).toBe("port-end")
  const inputRoutes = solver.unsolvedRoutes[0]!.hdRoutes
  solver.solve()
  expect(solver.solved).toBe(true)
  const terminals = [
    { x: 0, y: 0 },
    { x: 0.9, y: 0 },
  ]
  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Input: one island between distinct PCB terminals",
        step: 0,
        graphics: visualizeFragments(inputRoutes, terminals),
      },
      {
        name: "Result: start and end stay paired",
        step: 1,
        iteration: solver.iterations,
        graphics: {
          ...solver.visualize(),
          circles: visualizeFragments([], terminals).circles,
        },
      },
    ],
    columns: 2,
    cellWidth: 1.3,
    cellHeight: 0.8,
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
