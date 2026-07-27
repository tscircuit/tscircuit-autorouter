import { expect, test } from "bun:test"
import { PreloadedTraceGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preloaded-trace-graph-solver"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson } from "lib/types"

const createPort = (
  id: string,
  y: number,
  z: number,
): SegmentPortPoint => ({
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

test("preloaded traces reserve existing graph ports without changing topology", () => {
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
  const topologyBefore = sharedEdgeSegments.map((segment) => ({
    edgeId: segment.edgeId,
    nodeIds: [...segment.nodeIds],
    start: { ...segment.start },
    end: { ...segment.end },
    availableZ: [...segment.availableZ],
    ports: segment.portPoints.map((portPoint) => ({
      id: portPoint.segmentPortPointId,
      x: portPoint.x,
      y: portPoint.y,
      z: [...portPoint.availableZ],
    })),
  }))
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
          { x: -1, y: 0.42, layer: "top" },
          { x: 1, y: 0.42, layer: "top" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed-trace",
        connection_name: "child-net",
        route: [
          { route_type: "wire", x: -1, y: 0.42, width: 0.1, layer: "top" },
          { route_type: "wire", x: 1, y: 0.42, width: 0.1, layer: "top" },
        ],
      },
    ],
  }
  const solver = new PreloadedTraceGraphSolver(sharedEdgeSegments, srj)

  solver.solve()

  const topologyAfter = solver.getOutput().map((segment) => ({
    edgeId: segment.edgeId,
    nodeIds: [...segment.nodeIds],
    start: { ...segment.start },
    end: { ...segment.end },
    availableZ: [...segment.availableZ],
    ports: segment.portPoints.map((portPoint) => ({
      id: portPoint.segmentPortPointId,
      x: portPoint.x,
      y: portPoint.y,
      z: [...portPoint.availableZ],
    })),
  }))
  expect(topologyAfter).toEqual(topologyBefore)
  expect(sharedEdgeSegments[0]!.portPoints).toEqual([
    expect.objectContaining({
      segmentPortPointId: "top-low",
      connectionName: null,
    }),
    expect.objectContaining({
      segmentPortPointId: "top-mid",
      connectionName: null,
    }),
    expect.objectContaining({
      segmentPortPointId: "top-high",
      connectionName: "child-net",
      rootConnectionName: "root-net",
      _preloadedFixedNetIds: ["root-net"],
    }),
    expect.objectContaining({
      segmentPortPointId: "bottom-high",
      connectionName: null,
    }),
  ])
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
