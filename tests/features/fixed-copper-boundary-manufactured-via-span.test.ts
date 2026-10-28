import { expect, test } from "bun:test"
import { annotateFixedCopperBoundarySupply } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/annotateFixedCopperBoundarySupply"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson } from "lib/types"

test("through-via boundary supply covers the manufactured stack while explicit blind vias retain their span", () => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.1, minViaPadDiameter: 0.4, defaultObstacleMargin: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles: [], connections: [],
    traces: [{ type: "pcb_trace", pcb_trace_id: "via", connection_name: "fixed", route: [
      { route_type: "via", x: 0, y: 0, from_layer: "inner1", to_layer: "inner2", via_diameter: 0.4 },
    ] }],
  }
  const segment: SharedEdgeSegment = { edgeId: "edge", nodeIds: ["left", "right"], start: { x: 0, y: -0.1 }, end: { x: 0, y: 0.1 }, availableZ: [0, 1, 2, 3],
    portPoints: [0, 1, 2, 3].map((z) => ({ segmentPortPointId: `port-${z}`, edgeId: "edge", nodeIds: ["left", "right"], x: 0, y: 0,
      availableZ: [z], connectionName: null, distToCentermostPortOnZ: 0, cramped: false })),
  }
  annotateFixedCopperBoundarySupply([segment], srj)
  for (const [z, point] of segment.portPoints.entries()) expect(point.allowedNetIdByZ?.[z]).toBeTypeOf("string")
  annotateFixedCopperBoundarySupply([segment], { ...srj, allowBlindAndBuriedVias: true })
  expect(segment.portPoints[0]!.allowedNetIdByZ).toBeUndefined()
  expect(segment.portPoints[3]!.allowedNetIdByZ).toBeUndefined()
  expect(segment.portPoints[1]!.allowedNetIdByZ?.[1]).toBeTypeOf("string")
  expect(segment.portPoints[2]!.allowedNetIdByZ?.[2]).toBeTypeOf("string")
})
