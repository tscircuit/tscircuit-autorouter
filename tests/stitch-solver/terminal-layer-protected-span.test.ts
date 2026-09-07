import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("legal terminal layers preserve an explicit plated-hole span and its copper metadata", (): void => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "protected-net",
    startPcbPortId: "start-port",
    endPcbPortId: "end-port",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      {
        x: 1,
        y: 0,
        z: 0,
        traceThickness: 0.2,
        toNextSegmentType: "through_obstacle",
        toNextSegmentCircuitJsonMetadata: {
          pcb_plated_hole_id: "protected-plated-hole",
          pcb_port_id: "protected-port",
        },
      },
      { x: 1, y: 0, z: 1, traceThickness: 0.2 },
      { x: 2, y: 0, z: 1 },
    ],
    vias: [],
  }
  const inputSnapshot = structuredClone(route)
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: route.connectionName,
    start: { x: 0, y: 0, z: 0, pcb_port_id: "start-port" },
    end: { x: 2, y: 0, z: 1, pcb_port_id: "end-port" },
    hdRoutes: [route],
    allowedLayerTransitionPointKeys: new Set(),
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear",
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route).toEqual(route.route)
  expect(solver.mergedHdRoute.vias).toEqual([])
  expect(solver.mergedHdRoute.startPcbPortId).toBe("start-port")
  expect(solver.mergedHdRoute.endPcbPortId).toBe("end-port")
  const converted = convertHdRouteToSimplifiedRoute(solver.mergedHdRoute, 2)
  expect(
    converted.filter(
      (point): boolean => point.route_type === "through_obstacle",
    ),
  ).toEqual([
    {
      route_type: "through_obstacle",
      start: { x: 1, y: 0 },
      end: { x: 1, y: 0 },
      from_layer: "top",
      to_layer: "bottom",
      width: 0.2,
      circuitJsonMetadata: {
        pcb_plated_hole_id: "protected-plated-hole",
        pcb_port_id: "protected-port",
      },
    },
  ])
  expect(route).toEqual(inputSnapshot)
})
