import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectionAllowedZ } from "lib/utils/getConnectionAllowedZ"
import { getPipeline9WireLayerErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9WireLayerErrors"
import { createPipeline9WireLayerDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9WireLayerDrcEvaluator"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"

test("Pipeline9 guards the recorded ButterStick bus layer without restricting through vias", (): void => {
  // Actual positive-length inner4 wire from the invalid joint ButterStick run.
  const a = { x: -7.571821933874125, y: 0.7788736796148741 }
  const b = { x: -8.639821933874124, y: 0.24487367961487405 }
  const srj: SimpleRouteJson = {
    bounds: { minX: -20, maxX: 20, minY: -20, maxY: 20 },
    layerCount: 8,
    minTraceWidth: 0.089,
    obstacles: [],
    connections: [
      {
        name: "source_trace_43_mst1",
        source_trace_id: "source_trace_43",
        __rootConnectionNames: ["source_trace_43"],
        pointsToConnect: [
          { ...a, layer: "top" },
          { ...b, layer: "top" },
        ],
      },
    ],
    buses: [
      {
        busId: "byte1",
        connectionNames: ["source_trace_43"],
        allowedLayers: ["top", "inner2", "inner5", "inner6", "bottom"],
      },
    ],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "source_trace_43_mst1_0",
    connection_name: "source_trace_43_mst1",
    route: [
      { route_type: "wire", ...a, layer: "inner4", width: 0.12 },
      { route_type: "wire", ...b, layer: "inner4", width: 0.12 },
    ],
  }
  const check = (
    traces: SimplifiedPcbTrace[],
    input = srj,
  ): Record<string, unknown>[] =>
    getPipeline9WireLayerErrors({
      traces,
      allowedZByConnectionName: getConnectionAllowedZ(input),
      layerCount: 8,
    })
  expect(check([trace])).toMatchObject([{ drc_source: "wire_layer" }])
  expect(
    check([{ ...trace, connection_name: "unrestricted-address" }]),
  ).toEqual([])
  expect(
    check([{ ...trace, route: [trace.route[0]!, trace.route[0]!] }]),
  ).toEqual([])
  const viaA = {
    route_type: "via",
    ...a,
    from_layer: "top",
    to_layer: "inner4",
  } as const
  const viaB = {
    route_type: "via",
    ...b,
    from_layer: "inner4",
    to_layer: "bottom",
  } as const
  for (const route of [
    [trace.route[0]!, viaB],
    [viaA, trace.route[1]!],
    [viaA, viaB],
  ]) {
    expect(check([{ ...trace, route }])).toMatchObject([
      { drc_source: "wire_layer" },
    ])
  }
  expect(check([{ ...trace, route: [viaA, trace.route[0]!] }])).toEqual([])
  expect(
    check([
      {
        ...trace,
        route: [
          {
            route_type: "through_obstacle",
            start: a,
            end: b,
            from_layer: "inner4",
            to_layer: "inner4",
            width: 0.12,
          },
          trace.route[1]!,
        ],
      },
    ]),
  ).toEqual([])
  const preloaded = {
    ...trace,
    connection_name: "fanout-alias",
    connectsTo: ["source_trace_43"],
  }
  expect(check([preloaded], { ...srj, traces: [preloaded] })).toMatchObject([
    { drc_source: "wire_layer" },
  ])
  expect(
    check([
      {
        ...trace,
        route: [
          { route_type: "wire", ...a, layer: "top", width: 0.12 },
          {
            route_type: "via",
            ...a,
            from_layer: "top",
            to_layer: "bottom",
            layers: [
              "top",
              "inner1",
              "inner2",
              "inner3",
              "inner4",
              "inner5",
              "inner6",
              "bottom",
            ],
            via_diameter: 0.4,
            via_hole_diameter: 0.2,
          },
          { route_type: "wire", ...a, layer: "bottom", width: 0.12 },
          { route_type: "wire", ...b, layer: "bottom", width: 0.12 },
        ],
      },
    ]),
  ).toEqual([])

  const evaluator = createPipeline9WireLayerDrcEvaluator(srj)!
  const result = evaluator({
    hdRoutes: [
      {
        connectionName: "source_trace_43_mst1",
        traceThickness: 0.12,
        viaDiameter: 0.4,
        vias: [],
        route: [
          { ...a, z: 4 },
          { ...b, z: 4 },
        ],
      },
    ],
    traces: [],
  })
  expect(Array.isArray(result) ? result : result.errors).toMatchObject([
    { drc_source: "wire_layer" },
  ])
  const physicalReference = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: srj,
    srjWithPointPairs: srj,
  })([trace])
  expect(
    physicalReference.errors.some((error) => error.drc_source === "wire_layer"),
  ).toBeTrue()
  expect(
    createPipeline9WireLayerDrcEvaluator({ ...srj, buses: undefined }),
  ).toBeUndefined()
})
