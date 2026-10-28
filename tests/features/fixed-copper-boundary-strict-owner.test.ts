import { expect, test } from "bun:test"
import { annotateFixedCopperBoundarySupply } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/annotateFixedCopperBoundarySupply"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("rounded coordinate unions cannot authorize physical boundary sharing", () => {
  const srj: SimpleRouteJson = {
    layerCount: 1, minTraceWidth: 0.1, defaultObstacleMargin: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles: [],
    connections: [
      { name: "owner", pointsToConnect: [{ x: 0.001, y: 0.001, layer: "top", pointId: "a" }, { x: -1, y: -1, layer: "top", pointId: "b" }] },
      { name: "foreign", pointsToConnect: [{ x: 0.002, y: 0.002, layer: "top", pointId: "c" }, { x: 1, y: 1, layer: "top", pointId: "d" }] },
    ],
    traces: [{ type: "pcb_trace", pcb_trace_id: "trace", connection_name: "owner", route: [
      { route_type: "wire", x: 0, y: -1, layer: "top", width: 0.3 },
      { route_type: "wire", x: 0, y: 1, layer: "top", width: 0.3 },
    ] }],
  }
  expect(getConnectivityMapFromSimpleRouteJson(srj).areIdsConnected("owner", "foreign")).toBe(true)
  const segment: SharedEdgeSegment = { edgeId: "edge", nodeIds: ["lower", "upper"], start: { x: -0.1, y: 0 }, end: { x: 0.1, y: 0 }, availableZ: [0],
    portPoints: [{ segmentPortPointId: "port", edgeId: "edge", nodeIds: ["lower", "upper"], x: 0, y: 0, availableZ: [0], connectionName: null, distToCentermostPortOnZ: 0, cramped: false }] }
  annotateFixedCopperBoundarySupply([segment], srj)
  expect(segment.portPoints[0]!.allowedNetIdByZ?.[0]).toBe(null)
})
