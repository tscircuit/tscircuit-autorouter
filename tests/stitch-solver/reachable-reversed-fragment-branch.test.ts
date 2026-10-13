import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("keeps the reversed exit of a fragment reachable through another branch", (): void => {
  const makeRoute = (
    regionId: string,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): HighDensityIntraNodeRoute => ({
    connectionName: "branched-pair",
    regionId,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { ...start, z: 0 },
      { ...end, z: 0 },
    ],
    vias: [],
  })
  const routes = [
    makeRoute("a", { x: 1, y: 0 }, { x: 10, y: 0 }),
    makeRoute("b", { x: -1, y: 0 }, { x: 10, y: 1 }),
    makeRoute("d", { x: -10, y: 0 }, { x: 0, y: 0 }),
  ]
  const original = structuredClone(routes)
  for (const hdRoutes of [routes, [...routes].reverse()]) {
    const solver = new SingleHighDensityRouteStitchSolver3({
      connectionName: "branched-pair",
      start: { x: -10, y: 0, z: 0, pcb_port_id: "start-pad" },
      end: { x: 2, y: 0, z: 0, pcb_port_id: "end-pad" },
      hdRoutes,
      preserveTerminalPcbPortIds: true,
      validateTerminalContacts: true,
      allowedLayerTransitionPointKeys: new Set<string>(),
      isStitchSegmentClear: (): boolean => true,
      stitchClearanceMode: "require_clear",
    })
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.mergedHdRoute.startPcbPortId).toBe("start-pad")
    expect(solver.mergedHdRoute.endPcbPortId).toBe("end-pad")
    expect(solver.mergedHdRoute.route).toEqual([
      { x: -10, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 10, y: 1, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ])
    expect(solver.mergedHdRoute.vias).toHaveLength(0)
    expect(solver.remainingHdRoutes).toHaveLength(0)
  }
  expect(routes).toEqual(original)
})
