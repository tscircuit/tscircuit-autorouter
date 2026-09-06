import { expect, test } from "bun:test"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("terminal transitions reuse explicitly represented via spans and obey the allowlist", (): void => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "via-net",
    startPcbPortId: "start-port",
    endPcbPortId: "end-port",
    traceThickness: 0.15,
    viaDiameter: 0.6,
    route: [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 3, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
    ],
    vias: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
  }
  const inputSnapshot = structuredClone(route)
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    minViaHoleDiameter: 0.3,
    bounds: { minX: -1, maxX: 4, minY: -1, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: route.connectionName,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "start-port" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "end-port" },
        ],
      },
    ],
  }
  const originalTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "via-trace",
    connection_name: route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, 2),
  }
  const originalCircuitJson = convertToCircuitJson(srj, [originalTrace])
  expect(getDrcErrors(originalCircuitJson).errors).toEqual([])
  expect(
    originalCircuitJson.filter(
      (element): boolean => element.type === "pcb_via",
    ),
  ).toHaveLength(4)
  for (const { allowEnd, reverseInput } of [
    { allowEnd: true, reverseInput: false },
    { allowEnd: true, reverseInput: true },
    { allowEnd: false, reverseInput: false },
    { allowEnd: false, reverseInput: true },
  ]) {
    const solverRoute: HighDensityIntraNodeRoute = reverseInput
      ? {
          ...route,
          startPcbPortId: route.endPcbPortId,
          endPcbPortId: route.startPcbPortId,
          route: [...route.route].reverse(),
        }
      : route
    const solverInputSnapshot = structuredClone(solverRoute)
    const allowedVias = allowEnd
      ? route.vias
      : route.vias.filter((via): boolean => via.x !== 2)
    const solver = new SingleHighDensityRouteStitchSolver3({
      connectionName: route.connectionName,
      start: { x: 0, y: 0, z: 0, pcb_port_id: "start-port" },
      end: { x: 2, y: 0, z: 0, pcb_port_id: "end-port" },
      hdRoutes: [solverRoute],
      allowedLayerTransitionPointKeys: new Set(allowedVias.map(getXyPointKey)),
      preserveTerminalPcbPortIds: true,
      isStitchSegmentClear: (): boolean => true,
      stitchClearanceMode: "require_clear",
    })
    solver.solve()

    expect(solver.solved).toBe(allowEnd)
    expect(solver.failed).toBe(!allowEnd)
    expect(solver.mergedHdRoute.vias).toEqual(route.vias)
    expect(route).toEqual(inputSnapshot)
    expect(solverRoute).toEqual(solverInputSnapshot)
    if (!allowEnd) {
      expect(solver.error).toContain("existing allowed via")
      continue
    }
    expect(solver.mergedHdRoute.route).toEqual([
      { x: 0, y: 0, z: 0 },
      ...route.route,
      { x: 2, y: 0, z: 0 },
    ])
    const converted = convertHdRouteToSimplifiedRoute(solver.mergedHdRoute, 2)
    expect(converted[0]).toMatchObject({
      route_type: "wire",
      x: 0,
      y: 0,
      layer: "top",
    })
    expect(converted[converted.length - 1]).toMatchObject({
      route_type: "wire",
      x: 2,
      y: 0,
      layer: "top",
    })
    const repairedCircuitJson = convertToCircuitJson(srj, [
      { ...originalTrace, route: converted },
    ])
    expect(
      repairedCircuitJson.filter(
        (element): boolean => element.type === "pcb_via",
      ),
    ).toHaveLength(4)
    expect(getDrcErrors(repairedCircuitJson).errors).toEqual([])
    expect(solver.mergedHdRoute.startPcbPortId).toBe("start-port")
    expect(solver.mergedHdRoute.endPcbPortId).toBe("end-port")
  }
})
