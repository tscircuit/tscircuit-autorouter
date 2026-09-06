import { expect, test } from "bun:test"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("single-layer terminals cannot be silently reassigned to fragment layers", (): void => {
  for (const mismatch of ["start", "end"] as const) {
    const route: HighDensityIntraNodeRoute = {
      connectionName: "terminal-net",
      startPcbPortId: "start-port",
      endPcbPortId: "end-port",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route:
        mismatch === "start"
          ? [
              { x: 0, y: 0, z: 1 },
              { x: 1, y: 0, z: 1 },
              { x: 1, y: 0, z: 0 },
              { x: 2, y: 0, z: 0 },
            ]
          : [
              { x: 0, y: 0, z: 0 },
              { x: 2, y: 0, z: 0 },
            ],
      vias: mismatch === "start" ? [{ x: 1, y: 0 }] : [],
    }
    const inputSnapshot = structuredClone(route)
    const mismatchPoint = { x: mismatch === "start" ? 0 : 2, y: 0 }
    for (const allowedLayerTransitionPointKeys of [
      undefined,
      new Set<string>(),
      new Set([getXyPointKey(mismatchPoint)]),
    ]) {
      const solver = new SingleHighDensityRouteStitchSolver3({
        connectionName: route.connectionName,
        start: { x: 0, y: 0, z: 0, pcb_port_id: "start-port" },
        end: {
          x: 2,
          y: 0,
          z: mismatch === "end" ? 1 : 0,
          pcb_port_id: "end-port",
        },
        hdRoutes: [route],
        allowedLayerTransitionPointKeys,
        preserveTerminalPcbPortIds: true,
        isStitchSegmentClear: (): boolean => true,
        stitchClearanceMode: "prefer_clear",
      })
      solver.solve()

      expect(solver.solved).toBe(false)
      expect(solver.failed).toBe(true)
      expect(solver.error).toContain("existing allowed via")
      expect(solver.mergedHdRoute.route[0]!.z).toBe(0)
      expect(solver.mergedHdRoute.startPcbPortId).toBe("start-port")
      expect(solver.mergedHdRoute.endPcbPortId).toBe("end-port")
      expect(route).toEqual(inputSnapshot)
    }
  }
})
