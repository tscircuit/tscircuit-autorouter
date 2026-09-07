import { expect, test } from "bun:test"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 preserves an opaque pad identity ending with an existing via id", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "A",
      rootConnectionName: "A",
      regionId: "wire-node",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 5, z: 0 },
        { x: -2, y: 5, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "B",
      rootConnectionName: "B",
      regionId: "via-node",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 5, z: 0 },
        { x: 0, y: 5, z: 1 },
      ],
      vias: [{ x: 0, y: 5 }],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, maxX: 4, minY: -2, maxY: 7 },
    connections: [
      ...routes.map((route) => ({
        name: route.connectionName,
        pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
          (point, index) => ({
            x: point.x,
            y: point.y,
            layer: point.z === 0 ? "top" : "bottom",
            pcb_port_id: `${route.connectionName}-${index}`,
          }),
        ),
      })),
      {
        name: "pad-net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pad-port" },
          { x: 3, y: 3, layer: "top", pcb_port_id: "other-pad-port" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["pad-net", "pad-port"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "opaque.pad_via_0",
          pcb_port_id: "pad-port",
        },
      },
    ],
  }
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections: srj.connections.slice(0, 2),
    originalConnections: srj.connections,
    hdRoutes: routes,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    originalSrj: srj,
    srjWithPointPairs: srj,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
  })

  const errors = getPipeline9DrcErrors(evaluator, routes)
  const padError = errors.find(
    (error) => error.pcb_trace_error_id === "overlap_A_0_opaque.pad_via_0",
  )
  expect(padError).toBeDefined()
  expect(padError!.__pad_ids).toEqual(["opaque.pad_via_0"])
  expect(padError!.__trace_segment_owner_trace_id).toBe("A_0")
  expect(padError!.__via_owner_trace_ids).toBeUndefined()
  expect(padError!.pcb_via_id).toBeUndefined()
  expect(errors).toContainEqual(
    expect.objectContaining({
      type: "pcb_trace_error",
      pcb_via_id: "via_0",
      __via_owner_trace_ids: ["B_0"],
      __trace_segment_owner_trace_id: "A_0",
    }),
  )
})
