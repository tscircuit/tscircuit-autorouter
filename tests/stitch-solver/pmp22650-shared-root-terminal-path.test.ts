import { expect, test } from "bun:test"
import { type GraphicsObject, mergeGraphics } from "graphics-debug"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import fixture from "./fixtures/pmp22650-shared-root-terminal-path.json"

const targetConnectionName = "source_net_altium_pcb_404_mst23"
const targetConnection = (fixture.connections as SimpleRouteConnection[]).find(
  (connection) => connection.name === targetConnectionName,
)!

const getHdRouteGraphics = (
  hdRoutes: HighDensityIntraNodeRoute[],
): GraphicsObject => ({
  lines: hdRoutes.map((hdRoute) => ({
    points: hdRoute.route,
    strokeColor:
      hdRoute.connectionName === targetConnectionName ? "#2563eb" : "#f97316",
    strokeWidth: hdRoute.traceThickness,
    label: hdRoute.connectionName,
  })),
  circles: hdRoutes.flatMap((hdRoute) =>
    hdRoute.vias.map((via) => ({
      center: via,
      radius: hdRoute.viaDiameter / 2,
      fill: "#7c3aed",
    })),
  ),
})

const getTerminalIdentityGraphics = (
  route?: HighDensityIntraNodeRoute,
): GraphicsObject => {
  const retainedPcbPortIds = new Set([
    route?.startPcbPortId,
    route?.endPcbPortId,
  ])

  return {
    circles: targetConnection.pointsToConnect.map((point) => ({
      center: point,
      radius: 0.25,
      fill: retainedPcbPortIds.has(point.pcb_port_id) ? "#16a34a" : "#dc2626",
      label: point.pcb_port_id,
    })),
    texts: targetConnection.pointsToConnect.map((point) => ({
      x: point.x,
      y: point.y + 0.4,
      text: retainedPcbPortIds.has(point.pcb_port_id)
        ? "terminal retained"
        : "terminal missing",
      fontSize: 0.22,
      color: retainedPcbPortIds.has(point.pcb_port_id) ? "#166534" : "#991b1b",
    })),
  }
}

test("PMP22650 completes an MST branch through shared same-net copper", async () => {
  const hdRoutes = fixture.hdRoutes as HighDensityIntraNodeRoute[]
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: fixture.connections as SimpleRouteConnection[],
    hdRoutes,
    layerCount: 8,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })
  solver.solve()

  const targetRoutes = solver.mergedHdRoutes.filter(
    (route) => route.connectionName === targetConnectionName,
  )

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "Shared terminal escape",
          step: 0,
          graphics: getHdRouteGraphics(hdRoutes),
        },
        {
          name: "Stitched MST branch",
          step: "end",
          graphics: mergeGraphics(
            getHdRouteGraphics(hdRoutes),
            mergeGraphics(
              solver.visualize(),
              getTerminalIdentityGraphics(targetRoutes[0]),
            ),
          ),
        },
      ],
      columns: 1,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })

  expect(targetRoutes).toHaveLength(1)
  expect(
    new Set([targetRoutes[0]?.startPcbPortId, targetRoutes[0]?.endPcbPortId]),
  ).toEqual(new Set(["pcb_port_altium_6701", "pcb_port_altium_7016"]))
})
