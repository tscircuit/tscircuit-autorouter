import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type {
  HighDensityIntraNodeRoute,
  PortPoint,
} from "lib/types/high-density-types"

type JunctionPoint = HighDensityIntraNodeRoute["route"][number] & PortPoint

test("stitching consumes a shared point before an equally scored outgoing fragment", (): void => {
  const junctionPoint: JunctionPoint = {
    portPointId: "junction_port",
    connectionName: "point_chain",
    rootConnectionName: "point_chain",
    nextPortPointId: "continuation_port",
    x: -0.4,
    y: -0.4,
    z: 0,
    traceThickness: 0.15,
  }
  const routePoints: HighDensityIntraNodeRoute["route"][] = [
    [
      { x: -3, y: -3, z: 0 },
      { x: -0.1, y: -0.8, z: 0 },
    ],
    [
      { x: -0.2, y: -0.2, z: 0 },
      { x: -0.4, y: -0.4, z: 0 },
    ],
    [
      { x: -0.2, y: -0.2, z: 0 },
      { x: 0.1, y: 0.1, z: 0 },
      { x: 0.1, y: 0.1, z: 1 },
      { x: 0.4, y: 0.4, z: 1 },
    ],
    [junctionPoint],
  ]
  const routes = routePoints.map(
    (route, index): HighDensityIntraNodeRoute => ({
      connectionName: "point_chain",
      rootConnectionName: "point_chain",
      ...(index === 0 ? { startPcbPortId: "terminal_start" } : {}),
      ...(index === 2 ? { endPcbPortId: "terminal_end" } : {}),
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route,
      vias: index === 2 ? [{ x: 0.1, y: 0.1 }] : [],
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
      connectionName: "point_chain",
      hdRoutes,
      start: { x: -3, y: -3, z: 0, pcb_port_id: "terminal_start" },
      end: { x: 0.4, y: 0.4, z: 1, pcb_port_id: "terminal_end" },
      preserveTerminalPcbPortIds: true,
      isStitchSegmentClear: (): boolean => true,
      stitchClearanceMode: "require_clear",
    })

    solver.solve()

    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(solver.remainingHdRoutes).toHaveLength(0)
    expect(solver.mergedHdRoute.route).toEqual([
      { x: -3, y: -3, z: 0 },
      { x: -0.1, y: -0.8, z: 0 },
      junctionPoint,
      { x: -0.2, y: -0.2, z: 0 },
      { x: 0.1, y: 0.1, z: 0 },
      { x: 0.1, y: 0.1, z: 1 },
      { x: 0.4, y: 0.4, z: 1 },
    ])
    expect(solver.mergedHdRoute.vias).toEqual([{ x: 0.1, y: 0.1 }])
    expect(solver.mergedHdRoute.traceThickness).toBe(0.15)
    expect(solver.mergedHdRoute.startPcbPortId).toBe("terminal_start")
    expect(solver.mergedHdRoute.endPcbPortId).toBe("terminal_end")
  }
})
