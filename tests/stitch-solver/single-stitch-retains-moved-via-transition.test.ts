import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("stitching follows a moved via instead of inventing a transition at stale endpoints", (): void => {
  const routePoints: HighDensityIntraNodeRoute["route"][] = [
    [
      { x: -3, y: 3, z: 1 },
      { x: -3, y: 2.5, z: 1 },
    ],
    [
      { x: -3, y: 2.5, z: 1 },
      { x: -2, y: 2, z: 1 },
      { x: -2, y: 2, z: 0 },
      { x: -1, y: 2, z: 0 },
    ],
    [
      { x: -1, y: 2, z: 0 },
      { x: 0, y: 0.5, z: 0 },
    ],
    [
      { x: 0.15, y: 0.5, z: 0 },
      { x: 0.15, y: 0.5, z: 1 },
    ],
    [
      { x: 0, y: 0.5, z: 1 },
      { x: 0, y: 0.2, z: 1 },
    ],
    [
      { x: 0, y: 0.2, z: 1 },
      { x: 0, y: 0, z: 1 },
    ],
  ]
  const routes = routePoints.map(
    (route, index): HighDensityIntraNodeRoute => ({
      connectionName: "moved_via_chain",
      rootConnectionName: "moved_via_chain",
      ...(index === 0 ? { startPcbPortId: "terminal_start" } : {}),
      ...(index === routePoints.length - 1
        ? { endPcbPortId: "terminal_end" }
        : {}),
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route,
      vias:
        index === 1
          ? [{ x: -2, y: 2 }]
          : index === 3
            ? [{ x: 0.15, y: 0.5 }]
            : [],
    }),
  )
  const reversedRoutes = [...routes].reverse().map(
    (route): HighDensityIntraNodeRoute => ({
      ...route,
      route: [...route.route].reverse(),
      startPcbPortId: route.endPcbPortId,
      endPcbPortId: route.startPcbPortId,
    }),
  )

  for (const hdRoutes of [routes, reversedRoutes]) {
    const solver = new SingleHighDensityRouteStitchSolver3({
      connectionName: "moved_via_chain",
      hdRoutes,
      start: { x: -3, y: 3, z: 1, pcb_port_id: "terminal_start" },
      end: { x: 0, y: 0, z: 1, pcb_port_id: "terminal_end" },
      preserveTerminalPcbPortIds: true,
      isStitchSegmentClear: (): boolean => true,
      stitchClearanceMode: "require_clear",
    })

    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.remainingHdRoutes).toHaveLength(0)
    expect(solver.mergedHdRoute.route).toEqual([
      { x: -3, y: 3, z: 1 },
      { x: -3, y: 2.5, z: 1 },
      { x: -2, y: 2, z: 1 },
      { x: -2, y: 2, z: 0 },
      { x: -1, y: 2, z: 0 },
      { x: 0, y: 0.5, z: 0 },
      { x: 0.15, y: 0.5, z: 0 },
      { x: 0.15, y: 0.5, z: 1 },
      { x: 0, y: 0.5, z: 1 },
      { x: 0, y: 0.2, z: 1 },
      { x: 0, y: 0, z: 1 },
    ])
    expect(solver.mergedHdRoute.vias).toEqual([
      { x: -2, y: 2 },
      { x: 0.15, y: 0.5 },
    ])
    expect(solver.mergedHdRoute.traceThickness).toBe(0.15)
    expect(solver.mergedHdRoute.viaDiameter).toBe(0.3)
    expect(solver.mergedHdRoute.startPcbPortId).toBe("terminal_start")
    expect(solver.mergedHdRoute.endPcbPortId).toBe("terminal_end")
  }
})
