import { expect, test } from "bun:test"
import { PreloadedTraceGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preloaded-trace-graph-solver"
import {
  createRelaxedDrcTraceSet,
  evaluateRelaxedDrc,
} from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import { resolvePreloadedTraceCanonicalNetIds } from "lib/utils/resolvePreloadedTraceCanonicalNetIds"

const makePreloadedTraceChain = (): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  defaultObstacleMargin: 0,
  bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
  connections: [
    {
      name: "root-net",
      pointsToConnect: [
        {
          x: -2,
          y: 0,
          layer: "top",
          pointId: "point-a",
          pcb_port_id: "pcb_port_a",
        },
        {
          x: 2,
          y: 0,
          layer: "top",
          pointId: "point-c",
          pcb_port_id: "pcb_port_c",
        },
      ],
    },
  ],
  obstacles: [
    {
      type: "rect",
      obstacleId: "pad-a",
      center: { x: -2, y: 0 },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["fixed-a", "root-net", "pcb_port_a", "pcb_smtpad_a"],
    },
  ],
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "fixed-a",
      connection_name: "local-a",
      connectsTo: ["fixed-mid"],
      route: [
        { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: -0.5, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "fixed-mid",
      connection_name: "local-mid",
      connectsTo: ["fixed-a", "fixed-c"],
      route: [
        { route_type: "wire", x: -0.5, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0.5, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "fixed-c",
      connection_name: "local-c",
      connectsTo: ["fixed-mid"],
      route: [
        { route_type: "wire", x: 0.5, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ],
})

const makeCrossingCandidate = (connectionName: string): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  // Force a collision with the generated id for fixed-mid.
  pcb_trace_id: "preloaded_1_fixed-mid",
  connection_name: `${connectionName}_mst0`,
  route: [
    { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
    { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
  ],
})

const withCrossingPointPair = (
  srj: SimpleRouteJson,
  connectionName: string,
): SimpleRouteJson => ({
  ...srj,
  connections: [
    {
      name: `${connectionName}_mst0`,
      __rootConnectionNames: [connectionName],
      pointsToConnect: [
        {
          x: 0,
          y: -1,
          layer: "top",
          pcb_port_id: `pcb_port_${connectionName}_start`,
        },
        {
          x: 0,
          y: 1,
          layer: "top",
          pcb_port_id: `pcb_port_${connectionName}_end`,
        },
      ],
    },
  ],
})

test("shared resolver propagates obstacle-only evidence through an A-MID-C trace chain", () => {
  const canonicalNetByTraceId = resolvePreloadedTraceCanonicalNetIds(
    makePreloadedTraceChain(),
  )

  expect(Object.fromEntries(canonicalNetByTraceId)).toEqual({
    "fixed-a": "root-net",
    "fixed-mid": "root-net",
    "fixed-c": "root-net",
  })
})

test("preloaded graph assigns the canonical net to a middle trace port", () => {
  const middlePort = {
    segmentPortPointId: "middle-port",
    x: 0,
    y: 0,
    availableZ: [0],
    nodeIds: ["left", "right"] as [string, string],
    edgeId: "middle-edge",
    connectionName: null,
    distToCentermostPortOnZ: 0,
    cramped: false,
  }
  const solver = new PreloadedTraceGraphSolver(
    [
      {
        edgeId: "middle-edge",
        nodeIds: ["left", "right"],
        start: { x: 0, y: -1 },
        end: { x: 0, y: 1 },
        availableZ: [0],
        portPoints: [middlePort],
      },
    ],
    makePreloadedTraceChain(),
  )

  solver.solve()

  expect(solver.getOutput()).toHaveLength(1)
  expect(
    solver.getOutput()[0]?.portPoints[0]?._preloadedFixedNetIds,
  ).toEqual(["root-net"])
})

test("relaxed DRC namespaces trace links before canonical conversion", () => {
  const inputSrj = makePreloadedTraceChain()
  const sameNetCandidate = makeCrossingCandidate("root-net")
  const combinedTraces = createRelaxedDrcTraceSet(inputSrj, [sameNetCandidate])
  const fixedTraces = combinedTraces.slice(0, 3)

  expect(fixedTraces.map((trace) => trace.pcb_trace_id)).toEqual([
    "preloaded_0_fixed-a",
    "preloaded_1_fixed-mid_1",
    "preloaded_2_fixed-c",
  ])
  expect(fixedTraces.map((trace) => trace.connection_name)).toEqual([
    "root-net",
    "root-net",
    "root-net",
  ])
  expect(fixedTraces.map((trace) => trace.connectsTo)).toEqual([
    ["preloaded_1_fixed-mid_1"],
    ["preloaded_0_fixed-a", "preloaded_2_fixed-c"],
    ["preloaded_1_fixed-mid_1"],
  ])

  const srjWithPointPairs = withCrossingPointPair(inputSrj, "root-net")
  const preloadedTraceIds = new Set(
    fixedTraces.map((trace) => trace.pcb_trace_id),
  )
  const circuitJson = convertToCircuitJson(srjWithPointPairs, combinedTraces, {
    originalSrj: inputSrj,
    preloadedTraceIds,
  })
  const sourceTraceIdByPcbTraceId = new Map(
    circuitJson
      .filter((element) => element.type === "pcb_trace")
      .map((trace) => [trace.pcb_trace_id, trace.source_trace_id]),
  )

  expect(Object.fromEntries(sourceTraceIdByPcbTraceId)).toEqual({
    "preloaded_0_fixed-a": "root-net",
    "preloaded_1_fixed-mid_1": "root-net",
    "preloaded_2_fixed-c": "root-net",
    "preloaded_1_fixed-mid": "root-net",
  })

  const sameNetResult = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    traces: [sameNetCandidate],
  })
  expect(
    sameNetResult.errors.filter(
      (error) =>
        "pcb_trace_error_id" in error &&
        error.pcb_trace_error_id.startsWith("overlap_"),
    ),
  ).toHaveLength(0)

  const foreignNetCandidate = makeCrossingCandidate("foreign-net")
  const foreignNetResult = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: withCrossingPointPair(inputSrj, "foreign-net"),
    traces: [foreignNetCandidate],
  })
  const overlapErrors = foreignNetResult.errors.filter(
    (error) =>
      "pcb_trace_error_id" in error &&
      error.pcb_trace_error_id.startsWith("overlap_"),
  )

  expect(overlapErrors).toHaveLength(1)
  expect(
    overlapErrors[0] &&
      "pcb_trace_error_id" in overlapErrors[0] &&
      overlapErrors[0].pcb_trace_error_id,
  ).toContain("preloaded_1_fixed-mid_1")
  expect(
    overlapErrors[0] &&
      "pcb_trace_error_id" in overlapErrors[0] &&
      overlapErrors[0].pcb_trace_error_id,
  ).toContain("preloaded_1_fixed-mid")
})
