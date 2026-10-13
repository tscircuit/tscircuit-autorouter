import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("legacy unowned stitching keeps actual fragment layers at both ends", (): void => {
  const hdRoute: HighDensityIntraNodeRoute = {
    connectionName: "legacy-bottom-route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 1 },
      { x: 1.8, y: 0, z: 1 },
    ],
    vias: [],
  }
  const original = structuredClone(hdRoute)
  for (const preserveTerminalPcbPortIds of [undefined, false]) {
    const solver = new SingleHighDensityRouteStitchSolver3({
      connectionName: hdRoute.connectionName,
      start: { x: 0, y: 0, z: 0, pcb_port_id: "legacy-start" },
      end: { x: 2, y: 0, z: 0, pcb_port_id: "legacy-end" },
      hdRoutes: [hdRoute],
      preserveTerminalPcbPortIds,
      allowedLayerTransitionPointKeys: new Set<string>(),
      isStitchSegmentClear: (): boolean => true,
      stitchClearanceMode: "require_clear",
    })
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.mergedHdRoute.route).toEqual([
      { x: 0, y: 0, z: 1 },
      { x: 1.8, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
    ])
    expect(solver.mergedHdRoute.vias).toHaveLength(0)
    expect(solver.mergedHdRoute.startPcbPortId).toBeUndefined()
    expect(solver.mergedHdRoute.endPcbPortId).toBeUndefined()
  }
  expect(hdRoute).toEqual(original)
})
