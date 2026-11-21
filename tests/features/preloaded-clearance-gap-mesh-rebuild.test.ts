import { expect, test } from "bun:test"
import { ClearanceGapIndex } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/ClearanceGapIndex"
import { PreloadedTraceGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver"
import type { ClearanceGapPort } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPreloadedClearanceGapPorts"
import { assertDefined } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/assertDefined"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson } from "lib/types"

const srj: SimpleRouteJson = {
  bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
  layerCount: 2,
  minTraceWidth: 0.124,
  obstacles: [],
  connections: [],
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "saved",
      connection_name: "saved",
      isFixed: true,
      route: [
        { route_type: "wire", x: -1, y: 2, layer: "top", width: 0.124 },
        { route_type: "wire", x: 1, y: 2, layer: "top", width: 0.124 },
      ],
    },
  ],
}

function solveBoundary({
  edgeId,
  nodeIds,
  start,
  end,
}: Pick<
  SharedEdgeSegment,
  "edgeId" | "nodeIds" | "start" | "end"
>): PreloadedTraceGraphSolver {
  const availableZ = [0, 1]
  const solver = new PreloadedTraceGraphSolver(
    [
      {
        edgeId,
        nodeIds,
        start,
        end,
        availableZ,
        portPoints: [
          {
            ...start,
            edgeId,
            nodeIds,
            availableZ,
            segmentPortPointId: edgeId,
            connectionName: null,
            distToCentermostPortOnZ: 0,
            cramped: false,
          },
        ],
      },
    ],
    srj,
  )
  solver.solve()
  return solver
}

function getGapOnLayer(
  solver: PreloadedTraceGraphSolver,
  z: number,
): ClearanceGapPort {
  const gap = [...solver.clearanceGapsByPortId.values()].find(
    (gap) => gap.z === z,
  )
  assertDefined(gap, `Expected a generated clearance gap on layer ${z}`)
  return gap
}

test("a rebuilt mesh excludes the same physical gap on its original layer", () => {
  const before = solveBoundary({
    edgeId: "shared",
    nodeIds: ["left", "right"],
    start: { x: 0.000000499, y: 0 },
    end: { x: 0.100000499, y: 0 },
  })
  const excludedGaps = new ClearanceGapIndex()
  excludedGaps.add(getGapOnLayer(before, 0))

  // Reverse the boundary and cross a six-decimal rounding boundary by 2e-9 mm.
  const rebuilt = solveBoundary({
    edgeId: "rebuilt",
    nodeIds: ["new-right", "new-left"],
    start: { x: 0.100000501, y: 0 },
    end: { x: 0.000000501, y: 0 },
  })
  const routable = rebuilt.getRoutablePortPoints(excludedGaps)
  expect(routable).not.toContain(getGapOnLayer(rebuilt, 0).port)
  expect(routable).toContain(getGapOnLayer(rebuilt, 1).port)

  const narrower = solveBoundary({
    edgeId: "shorter",
    nodeIds: ["left", "right"],
    start: { x: 0.010000499, y: 0 },
    end: { x: 0.090000499, y: 0 },
  })
  expect(narrower.getRoutablePortPoints(excludedGaps)).toContain(
    getGapOnLayer(narrower, 0).port,
  )
})
