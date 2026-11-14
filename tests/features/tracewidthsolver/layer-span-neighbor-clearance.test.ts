import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("layer refinement indexes widened copper before refining its neighbor", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.45,
      vias: [{ x: 2, y: 0 }],
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 0, z: 1 },
        { x: 12, y: 0, z: 1 },
      ],
    },
    {
      connectionName: "neighbor",
      traceThickness: 0.1,
      viaDiameter: 0.45,
      vias: [],
      route: [
        { x: 4, y: 0.26, z: 1 },
        { x: 10, y: 0.26, z: 1 },
      ],
    },
  ]
  const solver = new TraceWidthSolver({
    hdRoutes: routes,
    connection: routes.map((route) => ({
      name: route.connectionName,
      nominalTraceWidth: 0.2,
      pointsToConnect: [],
    })),
    obstacles: [
      {
        type: "rect",
        center: { x: 1, y: 0.22 },
        width: 1,
        height: 0.1,
        layers: ["top"],
        connectedTo: [],
      },
    ],
    minTraceWidth: 0.1,
    obstacleMargin: 0.1,
    layerCount: 2,
  })
  solver.solve()
  // Cleanup can hand refinement routes narrower than initial width selection.
  const [signal, neighbor] = solver.refineWidths({ hdRoutes: routes })
  const signalWidth = signal!.route[2]!.traceThickness ?? signal!.traceThickness
  const neighborWidth =
    neighbor!.route[0]!.traceThickness ?? neighbor!.traceThickness
  expect(signalWidth).toBe(0.2)
  expect(neighborWidth).toBe(0.1)
  expect(0.26 - (signalWidth + neighborWidth) / 2).toBeGreaterThanOrEqual(0.1)
})
