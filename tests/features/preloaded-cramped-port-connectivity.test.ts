import { expect, test } from "bun:test"
import { PreloadedTraceGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

type Point = { x: number; y: number }

const createCrampedBoundary = (
  edgeId: string,
  nodeIds: [string, string],
  start: Point,
  end: Point,
  points: Point[],
): SharedEdgeSegment => ({
  edgeId,
  nodeIds,
  start,
  end,
  availableZ: [0],
  portPoints: points.map((point, index) => ({
    segmentPortPointId: `${edgeId}-${index}`,
    ...point,
    availableZ: [0],
    nodeIds,
    edgeId,
    connectionName: null,
    distToCentermostPortOnZ: index,
    cramped: true,
  })),
})

test("cramped-port pruning preserves the preloaded trace corridor", (): void => {
  const capacityMeshNodes: CapacityMeshNode[] = [
    { capacityMeshNodeId: "left", x: -2, y: 0 },
    { capacityMeshNodeId: "middle", x: 0, y: 0 },
    { capacityMeshNodeId: "right", x: 2, y: 0 },
    { capacityMeshNodeId: "unused", x: 0, y: 2 },
  ].map(({ capacityMeshNodeId, x, y }) => ({
    capacityMeshNodeId,
    center: { x, y },
    width: 2,
    height: 2,
    availableZ: [0],
    layer: "top",
  }))
  const sharedEdgeSegments = [
    createCrampedBoundary(
      "left-middle",
      ["left", "middle"],
      { x: -1, y: -1 },
      { x: -1, y: 1 },
      [
        { x: -1, y: 0 },
        { x: -1, y: 0.5 },
      ],
    ),
    createCrampedBoundary(
      "middle-right",
      ["middle", "right"],
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      [
        { x: 1, y: 0 },
        { x: 1, y: 0.5 },
      ],
    ),
    createCrampedBoundary(
      "middle-unused",
      ["middle", "unused"],
      { x: -1, y: 1 },
      { x: 1, y: 1 },
      [{ x: 0, y: 1 }],
    ),
  ]
  const simpleRouteJson: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.1,
    bounds: { minX: -3, minY: -1, maxX: 3, maxY: 3 },
    obstacles: [],
    connections: [],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "existing-trace",
        connection_name: "existing-net",
        route: [
          { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
          { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
        ],
      },
    ],
  }
  const preloadedSolver = new PreloadedTraceGraphSolver(
    sharedEdgeSegments,
    simpleRouteJson,
  )
  preloadedSolver.solve()
  const crampedSolver = new MultiTargetNecessaryCrampedPortPointSolver({
    sharedEdgeSegments: preloadedSolver.getOutput(),
    capacityMeshNodes,
    simpleRouteJson,
  })
  crampedSolver.solve()

  expect(crampedSolver.solved).toBeTrue()
  expect(crampedSolver.failed).toBeFalse()
  const ports = crampedSolver
    .getOutput()
    .flatMap((segment) => segment.portPoints)
  expect(ports.map((port) => port.segmentPortPointId)).toEqual([
    "left-middle-0",
    "middle-right-0",
  ])
  expect(
    ports.every((port) => port.tinyHypergraphPortPenalty === 1000),
  ).toBeTrue()

  const reachableNodes = new Set(["left"])
  const pendingNodes = ["left"]
  while (pendingNodes.length > 0) {
    const currentNode = pendingNodes.pop()!
    for (const port of ports) {
      if (!port.nodeIds.includes(currentNode)) continue
      for (const nodeId of port.nodeIds) {
        if (reachableNodes.has(nodeId)) continue
        reachableNodes.add(nodeId)
        pendingNodes.push(nodeId)
      }
    }
  }
  expect(reachableNodes).toEqual(new Set(["left", "middle", "right"]))
})
