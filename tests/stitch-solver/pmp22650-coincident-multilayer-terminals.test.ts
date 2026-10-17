import { expect, test } from "bun:test"
import { mergeGraphics, type GraphicsObject } from "graphics-debug"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import fixture from "./fixtures/pmp22650-coincident-multilayer-terminals.json"

const getHdRouteGraphics = (
  hdRoutes: HighDensityIntraNodeRoute[],
): GraphicsObject => ({
  lines: hdRoutes.map((hdRoute) => ({
    points: hdRoute.route,
    strokeColor: hdRoute.route[0]?.z === 0 ? "#2563eb" : "#dc2626",
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

test("PMP22650 collapses coincident top and bottom terminal identities", async () => {
  const hdRoutes = fixture.hdRoutes as HighDensityIntraNodeRoute[]
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: fixture.connections as SimpleRouteConnection[],
    hdRoutes,
    layerCount: 8,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })
  let solveError: Error | undefined
  try {
    solver.solve()
  } catch (error) {
    solveError = error instanceof Error ? error : new Error(String(error))
  }

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "Route fragments",
          step: 0,
          graphics: getHdRouteGraphics(hdRoutes),
        },
        {
          name: solveError ? "Failed" : "Stitched",
          step: "end",
          graphics: mergeGraphics(
            getHdRouteGraphics(hdRoutes),
            solver.visualize(),
          ),
        },
      ],
      columns: 2,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })

  expect(solveError?.message).toBe(
    'SingleHighDensityRouteStitchSolver3 received duplicate PCB terminal "pcb_port_altium_8623" for "source_net_altium_pcb_377_mst0"',
  )
  expect(solver.mergedHdRoutes).toHaveLength(0)
})
