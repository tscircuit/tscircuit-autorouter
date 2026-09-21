import { expect, test } from "bun:test"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("preloaded crossings use same-net escapes without adding redundant or dangling paths", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.1,
    bounds: { minX: -4, minY: -4, maxX: 4, maxY: 4 },
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
  const fixedNetId =
    getConnectivityMapFromSimpleRouteJson(srj).getNetConnectedToId(
      "existing-net",
    )!
  for (const padNet of ["existing-net", "foreign-net"]) {
    const nodes: CapacityMeshNode[] = ["left", "pad", "right", "dangling"].map(
      (id, index) => ({
        capacityMeshNodeId: id,
        center: { x: index, y: 0 },
        width: 1,
        height: 1,
        layer: "top",
        availableZ: [0],
        _containsObstacle: id === "pad",
        ...(id === "pad" ? { _connectedTo: [padNet] } : {}),
      }),
    )
    const segments: SharedEdgeSegment[] = [
      { edgeId: "left-pad", nodeIds: ["left", "pad"], cramped: false },
      { edgeId: "pad-right", nodeIds: ["pad", "right"], cramped: false },
      { edgeId: "direct", nodeIds: ["left", "right"], cramped: true },
      { edgeId: "spur", nodeIds: ["left", "dangling"], cramped: true },
    ].map(({ edgeId, nodeIds, cramped }, index) => ({
      edgeId,
      nodeIds: nodeIds as [string, string],
      start: { x: index, y: -1 },
      end: { x: index, y: 1 },
      availableZ: [0],
      portPoints: [
        {
          segmentPortPointId: edgeId,
          edgeId,
          nodeIds: nodeIds as [string, string],
          x: index,
          y: 0,
          availableZ: [0],
          connectionName: null,
          distToCentermostPortOnZ: 0,
          cramped,
          _preloadedTracePortAssignments: [
            {
              fixedNetId,
              traceId: "existing-trace",
              routePosition: index,
              tracePoint: { x: index, y: 0 },
              z: 0,
            },
          ],
        },
      ],
    }))
    const solver = new MultiTargetNecessaryCrampedPortPointSolver({
      capacityMeshNodes: nodes,
      sharedEdgeSegments: segments,
      simpleRouteJson: srj,
    })
    solver.solve()
    const ports = solver.getOutput().flatMap((segment) => segment.portPoints)
    expect(solver.solved).toBeTrue()
    expect(ports.map((port) => port.segmentPortPointId)).toEqual(
      padNet === "existing-net"
        ? ["left-pad", "pad-right"]
        : ["left-pad", "pad-right", "direct"],
    )
    if (padNet === "foreign-net") {
      expect(
        ports.find((port) => port.segmentPortPointId === "direct"),
      ).toHaveProperty("tinyHypergraphPortPenalty", 1000)
    }
  }
})
