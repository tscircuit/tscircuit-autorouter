import { expect, spyOn, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("joint repair checks and publishes copper back to fixed section terminals", (): void => {
  const preload: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "preload",
    connection_name: "preload",
    route: [
      { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "through_obstacle",
        start: { x: -1, y: 0 },
        end: { x: -1, y: 0 },
        from_layer: "top",
        to_layer: "bottom",
        width: 0.1,
        circuitJsonMetadata: { pcb_plated_hole_id: "fixed-hole" },
      },
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
    ],
  }
  const crossingRoute: HighDensityRoute = {
    connectionName: "crossing",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1.95, y: -1, z: 0 },
      { x: -1.95, y: 1, z: 0 },
    ],
    vias: [],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    obstacles: [],
    traces: [preload],
    connections: [
      {
        name: "crossing",
        pointsToConnect: [
          { x: -1.95, y: -1, layer: "top" },
          { x: -1.95, y: 1, layer: "top" },
        ],
      },
    ],
  }
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: [crossingRoute],
    updatedPreloadedTraces: [preload],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: [],
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  expect(solver.movablePreloadedSections).toHaveLength(2)
  const candidate: HighDensityRoute[] = [
    crossingRoute,
    ...solver.movablePreloadedSections.map(({ hdRoute }) => {
      const route = structuredClone(hdRoute)
      // Model a repair that trims endpoints inside connected copper. The
      // crossing now touches only the connection back to the original start.
      route.route[0]!.x += 0.3
      route.route.at(-1)!.x -= 0.3
      return route
    }),
  ]
  const exactRepair = solver.exactRepairSolver!
  const evaluation = exactRepair.params.drcEvaluator!({
    traces: [],
    routes: candidate,
  })
  const errors = Array.isArray(evaluation) ? evaluation : evaluation.errors
  expect(
    errors.some((error) =>
      String(error.pcb_trace_error_id).startsWith("overlap_"),
    ),
  ).toBeTrue()

  const output = spyOn(exactRepair, "getOutput").mockReturnValue(candidate)
  try {
    const rebuilt = solver.getUpdatedPreloadedTraces()[0]!
    const transitionIndex = rebuilt.route.findIndex(
      (point) => point.route_type === "through_obstacle",
    )
    expect(rebuilt.route[0]).toEqual(preload.route[0])
    expect(rebuilt.route.at(-1)).toEqual(preload.route.at(-1))
    expect(rebuilt.route[transitionIndex]).toEqual(preload.route[2])
    expect(rebuilt.route[transitionIndex - 1]).toEqual(preload.route[1])
    expect(rebuilt.route[transitionIndex + 1]).toEqual(preload.route[3])
  } finally {
    output.mockRestore()
  }
})
