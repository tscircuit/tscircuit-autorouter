import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { lockHdRouteTerminals } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/lock-hd-route-terminals"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { Obstacle, SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const createWidthSolver = ({
  hdRoute,
  connection,
  obstacle,
}: {
  hdRoute: HighDensityRoute
  connection: SimpleRouteConnection
  obstacle: Obstacle
}): TraceWidthSolver =>
  new TraceWidthSolver({
    hdRoutes: [hdRoute],
    connection: [connection],
    obstacles: [obstacle],
    minTraceWidth: 0.15,
    layerCount: 2,
  })

const getRouteGraphics = ({
  route,
  color,
  label,
}: {
  route: HighDensityRoute
  color: string
  label: string
}): GraphicsObject => ({
  lines: route.route.slice(0, -1).map((point, pointIndex) => ({
    points: [
      { x: point.x, y: point.y },
      {
        x: route.route[pointIndex + 1]!.x,
        y: route.route[pointIndex + 1]!.y,
      },
    ],
    strokeColor: color,
    strokeWidth: point.traceThickness ?? route.traceThickness,
    label,
  })),
  points: route.route.map((point) => ({
    x: point.x,
    y: point.y,
    color,
    label: point.pcb_port_id ?? label,
  })),
  rects: [],
  circles: [],
})

test("Pipeline7 locks terminals before calculating trace widths", async () => {
  const obstacle: Obstacle = {
    obstacleId: "narrow-terminal-pad",
    type: "rect",
    center: { x: 0, y: 0 },
    width: 1.1,
    height: 0.3,
    layers: ["top"],
    connectedTo: ["candidate", "candidate-start"],
  }
  const connection: SimpleRouteConnection = {
    name: "candidate",
    nominalTraceWidth: 0.4,
    pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "candidate-start" },
      { x: 2, y: 0, layer: "top", pcb_port_id: "candidate-end" },
    ],
  }
  const simplifiedRoute: HighDensityRoute = {
    connectionName: "candidate",
    traceThickness: 0.4,
    viaDiameter: 0.3,
    route: [
      { x: -0.8, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }
  const terminalIdentityRoute: HighDensityRoute = {
    ...simplifiedRoute,
    startPcbPortId: "candidate-start",
    endPcbPortId: "candidate-end",
  }

  const unlockedWidthSolver = createWidthSolver({
    hdRoute: simplifiedRoute,
    connection,
    obstacle,
  })
  unlockedWidthSolver.solve()
  const unlockedOutput = unlockedWidthSolver.getHdRoutesWithWidths()[0]!

  const [lockedRoute] = lockHdRouteTerminals(
    [simplifiedRoute],
    [connection],
    new Map([[connection.name, terminalIdentityRoute]]),
  )
  const lockedWidthSolver = createWidthSolver({
    hdRoute: lockedRoute!,
    connection,
    obstacle,
  })
  lockedWidthSolver.solve()
  const lockedOutput = lockedWidthSolver.getHdRoutesWithWidths()[0]!

  expect(unlockedOutput.route[0]!.traceThickness).toBe(0.4)
  expect(lockedRoute!.route[0]).toMatchObject({
    x: 0,
    y: 0,
    pcb_port_id: "candidate-start",
  })
  expect(lockedOutput.route[0]!.traceThickness).toBeLessThanOrEqual(
    obstacle.height + 1e-6,
  )

  const padGraphics = {
    center: obstacle.center,
    width: obstacle.width,
    height: obstacle.height,
    fill: "rgba(100, 116, 139, 0.18)",
    stroke: "#64748b",
    label: "0.30 mm terminal pad",
  }
  const beforeGraphics = getRouteGraphics({
    route: unlockedOutput,
    color: "#dc2626",
    label: "Width calculated from displaced endpoint",
  })
  beforeGraphics.rects!.push(padGraphics)
  const afterGraphics = getRouteGraphics({
    route: lockedOutput,
    color: "#16803c",
    label: "Terminal locked before taper calculation",
  })
  afterGraphics.rects!.push(padGraphics)

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "Before: taper misses terminal pad",
          graphics: beforeGraphics,
        },
        {
          name: "After: locked endpoint tapers to pad",
          graphics: afterGraphics,
        },
      ],
      columns: 2,
      cellWidth: 3,
      cellHeight: 0.8,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
