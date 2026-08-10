import { expect, test } from "bun:test"
import { PreloadedTraceGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preloaded-trace-graph-solver"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

const createPort = (id: string, y: number, z: number): SegmentPortPoint => ({
  segmentPortPointId: id,
  x: 0,
  y,
  availableZ: [z],
  nodeIds: ["left", "right"],
  edgeId: "shared-edge",
  connectionName: null,
  distToCentermostPortOnZ: Math.abs(y),
  cramped: false,
})

test("preloaded traces reserve existing ports without changing graph topology", () => {
  const sharedEdgeSegments: SharedEdgeSegment[] = [
    {
      edgeId: "shared-edge",
      nodeIds: ["left", "right"],
      start: { x: 0, y: -1 },
      end: { x: 0, y: 1 },
      availableZ: [0, 1],
      portPoints: [
        createPort("top-low", -0.5, 0),
        createPort("top-mid", 0, 0),
        createPort("top-high", 0.5, 0),
        createPort("bottom-high", 0.5, 1),
      ],
    },
  ]
  const topologyBefore = structuredClone(sharedEdgeSegments)
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "child-net",
        __rootConnectionNames: ["root-net"],
        pointsToConnect: [
          { x: -1, y: 0.42, layer: "top", pointId: "start" },
          { x: 1, y: 0.42, layer: "top", pointId: "end" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed-trace",
        connection_name: "fixed-trace",
        connectsTo: ["start", "end"],
        route: [
          { route_type: "wire", x: -1, y: 0.42, width: 0.1, layer: "top" },
          { route_type: "wire", x: 1, y: 0.42, width: 0.1, layer: "top" },
        ],
      },
    ],
  }
  const fixedNetId =
    getConnectivityMapFromSimpleRouteJson(srj).getNetConnectedToId(
      "fixed-trace",
    )
  const solver = new PreloadedTraceGraphSolver(sharedEdgeSegments, srj)

  solver.solve()

  expect(
    solver.getOutput().map((segment) => ({
      edgeId: segment.edgeId,
      nodeIds: segment.nodeIds,
      start: segment.start,
      end: segment.end,
      availableZ: segment.availableZ,
      portPoints: segment.portPoints.map((port) => ({
        segmentPortPointId: port.segmentPortPointId,
        x: port.x,
        y: port.y,
        availableZ: port.availableZ,
        nodeIds: port.nodeIds,
        edgeId: port.edgeId,
        connectionName: port.connectionName,
        distToCentermostPortOnZ: port.distToCentermostPortOnZ,
        cramped: port.cramped,
      })),
    })),
  ).toEqual(topologyBefore)
  expect(sharedEdgeSegments[0]!.portPoints[2]).toMatchObject({
    segmentPortPointId: "top-high",
    _preloadedFixedNetIds: [fixedNetId],
    _preloadedTracePortAssignments: [
      {
        traceId: "fixed-trace",
        fixedNetId,
        routePosition: 0.5,
        tracePoint: { x: 0, y: 0.42 },
        z: 0,
      },
    ],
  })
  expect(solver.stats).toMatchObject({
    inputBoundaryCount: 1,
    outputBoundaryCount: 1,
    inputPortCount: 4,
    outputPortCount: 4,
    preloadedPortCount: 1,
    tracePortAssignmentCount: 1,
    topologyChanged: false,
  })
})
