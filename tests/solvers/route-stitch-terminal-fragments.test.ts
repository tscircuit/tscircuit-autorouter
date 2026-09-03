import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityIntraNodeRoute["route"][number]

test("stitch gap edges do not bypass physical terminal fragments", (): void => {
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "signal",
      startPcbPortId: "top_port",
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0.2, z: 0 },
      ],
      traceThickness: 0.15,
      viaDiameter: 0.3,
      vias: [],
    },
    {
      connectionName: "signal",
      route: [
        { x: 0, y: 0.2, z: 0 },
        { x: 0.55, y: 0.525, z: 0 },
      ],
      traceThickness: 0.15,
      viaDiameter: 0.3,
      vias: [],
    },
    {
      connectionName: "signal",
      route: [
        { x: 0.55, y: 0.525, z: 0 },
        { x: 0.5, y: 0.8, z: 0 },
        { x: 0.5, y: 0.8, z: 1 },
        { x: 0.575, y: 0.525, z: 1 },
      ],
      traceThickness: 0.15,
      viaDiameter: 0.3,
      vias: [{ x: 0.5, y: 0.8 }],
    },
    {
      connectionName: "signal",
      route: [
        { x: 0.575, y: 0.525, z: 1 },
        { x: 0.225, y: 0.18, z: 1 },
      ],
      traceThickness: 0.15,
      viaDiameter: 0.3,
      vias: [],
    },
    {
      connectionName: "signal",
      route: [
        { x: 0.225, y: 0.18, z: 1 },
        { x: 0.225, y: -0.15, z: 1 },
      ],
      traceThickness: 0.15,
      viaDiameter: 0.3,
      vias: [],
    },
    {
      connectionName: "signal",
      endPcbPortId: "bottom_port",
      route: [
        { x: 0.225, y: -0.15, z: 1 },
        { x: 0.225, y: -0.475, z: 1 },
      ],
      traceThickness: 0.15,
      viaDiameter: 0.3,
      vias: [],
    },
  ]
  const variants: HighDensityIntraNodeRoute[][] = [
    routes,
    [...routes].reverse(),
    routes.map(
      (route): HighDensityIntraNodeRoute => ({
        ...route,
        startPcbPortId: route.endPcbPortId,
        endPcbPortId: route.startPcbPortId,
        route: [...route.route].reverse(),
      }),
    ),
  ]
  for (const hdRoutes of variants) {
    const solver = new MultipleHighDensityRouteStitchSolver3({
      connections: [
        {
          name: "signal",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top", pcb_port_id: "top_port" },
            {
              x: 0.225,
              y: -0.475,
              layer: "bottom",
              pcb_port_id: "bottom_port",
            },
          ],
        },
      ],
      hdRoutes,
      layerCount: 2,
      preserveTerminalPcbPortIds: true,
      preferSameLayerTerminalEndpoints: true,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.mergedHdRoutes).toHaveLength(1)
    const stitched: HighDensityIntraNodeRoute = solver.mergedHdRoutes[0]!
    const terminalPoints: ReadonlyMap<
      string | undefined,
      RoutePoint | undefined
    > = new Map([
      [stitched.startPcbPortId, stitched.route[0]],
      [stitched.endPcbPortId, stitched.route.at(-1)],
    ])
    expect(terminalPoints.get("top_port")).toEqual({ x: 0, y: 0, z: 0 })
    expect(terminalPoints.get("bottom_port")).toEqual({
      x: 0.225,
      y: -0.475,
      z: 1,
    })
  }
})
