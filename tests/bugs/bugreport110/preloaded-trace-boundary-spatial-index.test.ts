import { expect, test } from "bun:test"
import { PreloadedTraceGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson } from "lib/types"

test("preloaded copper indexes nearby boundaries without losing tolerance or layer filtering", () => {
  const boundaries: SharedEdgeSegment[] = Array.from(
    { length: 1000 },
    (_, index): SharedEdgeSegment => {
      const x: number =
        index === 0
          ? 1
          : index === 1
            ? 1 + 0.5e-6
            : index === 2
              ? 1 + 2e-6
              : index * 10
      return {
        edgeId: `edge-${index}`,
        nodeIds: ["left", "right"],
        start: { x, y: -1 },
        end: { x, y: 1 },
        availableZ: [0, 1],
        portPoints: [0, 1].map((z) => ({
          segmentPortPointId: `port-${index}-${z}`,
          x,
          y: 0,
          availableZ: [z],
          nodeIds: ["left", "right"],
          edgeId: `edge-${index}`,
          connectionName: null,
          distToCentermostPortOnZ: 0,
          cramped: false,
        })),
      }
    },
  )
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -2, maxX: 10000, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed",
        connection_name: "power",
        route: [
          { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" },
          { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
        ],
      },
    ],
  }
  const solver = new PreloadedTraceGraphSolver(boundaries, srj)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getOutput()).toBe(boundaries)
  expect(
    boundaries
      .flatMap((edge) => edge.portPoints)
      .filter((port) => port._preloadedFixedNetIds?.length)
      .map((port) => port.segmentPortPointId),
  ).toEqual(["port-0-0", "port-1-0"])
  expect(solver.stats.boundaryDistanceCheckCount).toBe(2)
  const empty = new PreloadedTraceGraphSolver([], srj)
  empty.solve()
  expect(empty.getOutput()).toEqual([])
  expect(empty.stats.boundaryDistanceCheckCount).toBe(0)
})
