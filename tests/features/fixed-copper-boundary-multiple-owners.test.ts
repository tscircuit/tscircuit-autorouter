import { expect, test } from "bun:test"
import { annotateFixedCopperBoundarySupply } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/annotateFixedCopperBoundarySupply"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("a fully occupied boundary can still permit multiple distinct physical copper owners", () => {
  const srj: SimpleRouteJson = {
    layerCount: 1, minTraceWidth: 0.1, defaultObstacleMargin: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles: [], connections: [],
    traces: [0, 0.5].map((x, index) => ({ type: "pcb_trace", pcb_trace_id: `trace-${index}`, connection_name: `owner-${index}`,
      route: [{ route_type: "wire", x, y: -1, layer: "top", width: 0.3 }, { route_type: "wire", x, y: 1, layer: "top", width: 0.3 }] })),
  }
  const segment: SharedEdgeSegment = {
    edgeId: "edge", nodeIds: ["lower", "upper"], start: { x: 0, y: 0 }, end: { x: 0.5, y: 0 }, availableZ: [0],
    portPoints: [0.1, 0.4].map((x, index) => ({ segmentPortPointId: `port-${index}`, edgeId: "edge", nodeIds: ["lower", "upper"], x, y: 0,
      availableZ: [0], connectionName: null, distToCentermostPortOnZ: 0, cramped: false })),
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const owners = [0, 1].map((index) => connMap.getNetConnectedToId(`owner-${index}`)!)
  expect(owners[0]).not.toBe(owners[1])
  expect(annotateFixedCopperBoundarySupply([segment], srj)).toEqual({ constrainedBoundaryLayers: 1, constrainedPorts: 2 })
  for (const [index, point] of segment.portPoints.entries()) expect(point.allowedNetIdByZ?.[0]).toBe(owners[index])
})
