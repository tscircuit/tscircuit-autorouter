import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { annotateFixedCopperBoundarySupply } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/annotateFixedCopperBoundarySupply"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson } from "lib/types"

test("boundary witnesses retain every packable generic slot and remove excess finite-width foreign capacity", () => {
  const srj: SimpleRouteJson = { layerCount: 1, minTraceWidth: 0.15, defaultObstacleMargin: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles: [], connections: [],
    traces: [{ type: "pcb_trace", pcb_trace_id: "trace", connection_name: "fixed", route: [
      { route_type: "wire", x: 0.5, y: -1, layer: "top", width: 0.2 },
      { route_type: "wire", x: 0.5, y: 1, layer: "top", width: 0.2 },
    ] }],
  }
  const segment: SharedEdgeSegment = { edgeId: "edge", nodeIds: ["lower", "upper"], start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, availableZ: [0],
    portPoints: [0.1, 0.3, 0.5, 0.7, 0.9].map((x, index) => ({ segmentPortPointId: `port-${index}`, edgeId: "edge", nodeIds: ["lower", "upper"], x, y: 0,
      availableZ: [0], connectionName: null, distToCentermostPortOnZ: 0, cramped: false })),
  }
  annotateFixedCopperBoundarySupply([segment], srj)
  const witnesses = segment.portPoints.filter((point) => point.allowedNetIdByZ?.[0] === undefined).map((point) => point.positionByZ![0]!)
  expect(witnesses).toHaveLength(2)
  for (const point of witnesses) expect(pointToSegmentDistance(point, srj.traces![0]!.route[0] as { x: number; y: number }, srj.traces![0]!.route[1] as { x: number; y: number })).toBeGreaterThanOrEqual((0.2 + 0.15) / 2 + 0.15)
  expect(Math.abs(witnesses[1]!.x - witnesses[0]!.x)).toBeGreaterThanOrEqual(0.3)
  expect(segment.portPoints[4]!.allowedNetIdByZ?.[0]).toBe(null)
  const wider = structuredClone(segment)
  wider.end.x = 2
  annotateFixedCopperBoundarySupply([wider], srj)
  expect(wider.portPoints.filter((point) => point.allowedNetIdByZ?.[0] === undefined)).toHaveLength(5)
  expect(wider.portPoints.map((point) => point.segmentPortPointId)).toEqual(segment.portPoints.map((point) => point.segmentPortPointId))
})
