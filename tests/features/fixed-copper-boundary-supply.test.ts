import { expect, test } from "bun:test"
import { annotateFixedCopperBoundarySupply } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/annotateFixedCopperBoundarySupply"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("immutable MIDI copper removes only zero-supply foreign layers, without filtering movable representative dots", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15, defaultObstacleMargin: 0.15,
    bounds: { minX: -50, maxX: 50, minY: -50, maxY: 50 }, obstacles: [], connections: [],
    traces: [{ type: "pcb_trace", pcb_trace_id: "user-trace", connection_name: "source_net_28", route: [
      { route_type: "wire", x: -40.71068099999998, y: 20.915975000000003, layer: "top", width: 0.2 },
      { route_type: "wire", x: -39.12695375164908, y: 22.4997022483509, layer: "top", width: 0.2 },
    ] }],
  }
  const createSegment = (id: string, start: number, end: number): SharedEdgeSegment => ({
    edgeId: id, nodeIds: ["lower", "upper"], start: { x: start, y: 21.615975000000002 },
    end: { x: end, y: 21.615975000000002 }, availableZ: [0, 1],
    portPoints: [0, 1].map((z) => ({ segmentPortPointId: `${id}-z${z}`, edgeId: id,
      nodeIds: ["lower", "upper"], x: (start + end) / 2, y: 21.615975000000002,
      availableZ: [z], connectionName: null, distToCentermostPortOnZ: 0, cramped: false })),
  })
  const blocked = createSegment("blocked", -40.11068099999998, -39.61068099999999)
  const movable = createSegment("movable", -41.01068099999998, -39.01068099999998)
  const corner = createSegment("corner", -40.01068099999998, -40.01068099999998)
  const before = structuredClone([blocked, movable, corner])
  const fixedNet = getConnectivityMapFromSimpleRouteJson(srj).getNetConnectedToId("source_net_28")!
  const diagnostics = annotateFixedCopperBoundarySupply([blocked, movable, corner], srj)
  expect(diagnostics).toEqual({ constrainedBoundaryLayers: 3, constrainedPorts: 2 })
  expect(blocked.portPoints[0]!.allowedNetIdByZ?.[0]).toBe(fixedNet)
  expect(blocked.portPoints[1]!.allowedNetIdByZ).toBeUndefined()
  expect(movable.portPoints.every((point) => point.allowedNetIdByZ === undefined)).toBe(true)
  expect(corner.portPoints[0]!.allowedNetIdByZ?.[0]).toBe(fixedNet)
  expect([blocked, movable, corner].map((segment) => ({ ...segment,
    portPoints: segment.portPoints.map(({ allowedNetIdByZ, positionByZ, ...point }) => point),
  }))).toEqual(before)
})
