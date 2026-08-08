import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const makeRoute = ({
  connectionName,
  startX,
  endX,
  startPcbPortId,
  endPcbPortId,
}: {
  connectionName: string
  startX: number
  endX: number
  startPcbPortId?: string
  endPcbPortId?: string
}): HighDensityIntraNodeRoute => ({
  connectionName,
  rootConnectionName: "root",
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

test("a same-root bridge may not carry sibling terminal tags into an MST", async () => {
  const currentStart = makeRoute({
    connectionName: "mst0",
    startX: 0,
    endX: 0.95,
    startPcbPortId: "port-start",
  })
  const currentEnd = makeRoute({
    connectionName: "mst0",
    startX: 2.05,
    endX: 3,
    endPcbPortId: "port-end",
  })
  const siblingBridge = makeRoute({
    connectionName: "mst1",
    startX: 1,
    endX: 2,
    startPcbPortId: "sibling-start",
    endPcbPortId: "sibling-end",
  })
  const unrelatedSibling = makeRoute({
    connectionName: "mst2",
    startX: 20,
    endX: 21,
  })
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [],
    hdRoutes: [],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })
  const getSharedRootPathRoutes = (
    solver as unknown as {
      getSharedRootPathRoutes: (params: {
        connectionName: string
        rootConnectionName: string
        hdRoutes: HighDensityIntraNodeRoute[]
        allHdRoutes: HighDensityIntraNodeRoute[]
        start: { x: number; y: number; z: number; pcb_port_id: string }
        end: { x: number; y: number; z: number; pcb_port_id: string }
      }) => HighDensityIntraNodeRoute[] | null
    }
  ).getSharedRootPathRoutes.bind(solver)

  const selectedRoutes = getSharedRootPathRoutes({
    connectionName: "mst0",
    rootConnectionName: "root",
    hdRoutes: [currentStart, currentEnd],
    allHdRoutes: [currentStart, currentEnd, siblingBridge, unrelatedSibling],
    start: { x: 0, y: 0, z: 0, pcb_port_id: "port-start" },
    end: { x: 3, y: 0, z: 0, pcb_port_id: "port-end" },
  })

  expect(selectedRoutes?.map((route) => route.connectionName)).toEqual([
    "mst0",
    "mst1",
    "mst0",
  ])
  const stitchSolver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "mst0",
    hdRoutes: selectedRoutes!,
    start: { x: 0, y: 0, z: 0, pcb_port_id: "port-start" },
    end: { x: 3, y: 0, z: 0, pcb_port_id: "port-end" },
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
  })
  stitchSolver.solve()
  expect(stitchSolver.solved).toBe(true)
  const terminals = [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
  ]
  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Input: current MST + orange same-root bridge",
        step: 0,
        graphics: visualizeFragments(selectedRoutes!, terminals),
      },
      {
        name: "Result: bridge joined; only current terminals kept",
        step: 1,
        iteration: stitchSolver.iterations,
        graphics: {
          ...stitchSolver.visualize(),
          circles: visualizeFragments([], terminals).circles,
        },
      },
    ],
    columns: 2,
    cellWidth: 3.5,
    cellHeight: 1,
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
