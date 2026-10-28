import { expect, test } from "bun:test"
import { annotateFixedCopperBoundarySupply } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/annotateFixedCopperBoundarySupply"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson } from "lib/types"

test("reroutable copper interiors leave no static footprint while their untouched tails remain physical constraints", () => {
  const srj: SimpleRouteJson = {
    layerCount: 1, minTraceWidth: 0.15, defaultObstacleMargin: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles: [], connections: [],
    traces: [{ type: "pcb_trace", pcb_trace_id: "trace", connection_name: "fixed", route: [
      { route_type: "wire", x: 0, y: -1, layer: "top", width: 0.2 },
      { route_type: "wire", x: 0, y: 1, layer: "top", width: 0.2 },
    ] }],
  }
  const segment: SharedEdgeSegment = {
    edgeId: "edge", nodeIds: ["lower", "upper"], start: { x: -0.25, y: 0 }, end: { x: 0.25, y: 0 }, availableZ: [0],
    portPoints: [{ segmentPortPointId: "port", edgeId: "edge", nodeIds: ["lower", "upper"], x: 0, y: 0,
      availableZ: [0], connectionName: null, distToCentermostPortOnZ: 0, cramped: false }],
  }
  expect(annotateFixedCopperBoundarySupply([segment], srj).constrainedBoundaryLayers).toBe(1)
  expect(segment.portPoints[0]!.allowedNetIdByZ?.[0]).toBeTypeOf("string")
  expect(annotateFixedCopperBoundarySupply([segment], srj, [{ traceId: "trace", startRoutePosition: 0.1, endRoutePosition: 0.9 }]).constrainedBoundaryLayers).toBe(0)
  expect(segment.portPoints[0]!.allowedNetIdByZ).toBeUndefined()
  expect(annotateFixedCopperBoundarySupply([segment], srj, [{ traceId: "trace", startRoutePosition: 0.5, endRoutePosition: 1 }]).constrainedBoundaryLayers).toBe(1)
  expect(segment.portPoints[0]!.allowedNetIdByZ?.[0]).toBeTypeOf("string")
  expect(annotateFixedCopperBoundarySupply([segment], srj, [{ traceId: "trace", startRoutePosition: 0, endRoutePosition: 1 }]).constrainedBoundaryLayers).toBe(0)
  expect(segment.portPoints[0]!.allowedNetIdByZ).toBeUndefined()
})
