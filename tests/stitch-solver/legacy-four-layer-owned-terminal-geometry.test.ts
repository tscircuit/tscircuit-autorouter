import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("legacy owned four-layer stitching preserves actual plated contact geometry", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    bounds: { minX: -2, maxX: 6, minY: -2, maxY: 2 },
    connections: [
      {
        name: "plated-bottom",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "start", pointId: "start" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "end", pointId: "end" },
        ],
      },
    ],
    obstacles: [0, 4].map((x) => ({
      type: "rect" as const,
      center: { x, y: 0 },
      width: 0.8,
      height: 0.8,
      layers: ["top", "inner1", "inner2", "bottom"],
      connectedTo: ["plated-bottom", x === 0 ? "start" : "end"],
      circuitJsonMetadata: {
        pcb_plated_hole_id: x === 0 ? "start_hole" : "end_hole",
        pcb_port_id: x === 0 ? "start" : "end",
      },
    })),
  }
  const fragment: HighDensityIntraNodeRoute = {
    connectionName: "plated-bottom",
    startPcbPortId: "start",
    endPcbPortId: "end",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 3, pcb_port_id: "start" },
      { x: 2, y: 0, z: 3 },
      { x: 4, y: 0, z: 3, pcb_port_id: "end" },
    ],
    vias: [],
  }
  const original = structuredClone(fragment)
  const expectedRoute = [
    { x: 0, y: 0, z: 3 },
    { x: 2, y: 0, z: 3 },
    { x: 4, y: 0, z: 3, pcb_port_id: "end" },
  ]
  const single = new SingleHighDensityRouteStitchSolver3({
    connectionName: fragment.connectionName,
    hdRoutes: [fragment],
    start: { x: 0, y: 0, z: 0, pcb_port_id: "start" },
    end: { x: 4, y: 0, z: 0, pcb_port_id: "end" },
    preserveTerminalPcbPortIds: true,
    allowedLayerTransitionPointKeys: new Set<string>(),
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear",
  })
  single.solve()
  expect(single.validateTerminalContacts).toBeFalse()
  expect(single.solved).toBeTrue()
  expect(single.failed).toBeFalse()
  expect(single.mergedHdRoute.route).toEqual(expectedRoute)
  expect(single.mergedHdRoute.vias).toEqual([])
  expect(single.mergedHdRoute.startPcbPortId).toBe("start")
  expect(single.mergedHdRoute.endPcbPortId).toBe("end")

  const multiple = new MultipleHighDensityRouteStitchSolver3({
    connections: srj.connections,
    hdRoutes: [fragment],
    layerCount: 4,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
    allowedLayerTransitionPointKeys: new Set<string>(),
  })
  multiple.solve()
  expect(multiple.solved).toBeTrue()
  expect(multiple.failed).toBeFalse()
  expect(multiple.mergedHdRoutes).toHaveLength(1)
  expect(multiple.mergedHdRoutes[0]!.route).toEqual(expectedRoute)
  expect(multiple.mergedHdRoutes[0]!.vias).toEqual([])
  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: srj.connections,
    originalConnections: srj.connections,
    hdRoutes: multiple.mergedHdRoutes,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
  })
  expect(traces).toHaveLength(1)
  expect(
    traces[0]!.route.every((point) => point.route_type === "wire"),
  ).toBeTrue()
  const validation = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: traces,
    includeBoardClearance: true,
  })
  expect(validation.errors).toHaveLength(0)
  expect(getDrcErrors(validation.circuitJson).errors).toHaveLength(0)
  expect(fragment).toEqual(original)
})
