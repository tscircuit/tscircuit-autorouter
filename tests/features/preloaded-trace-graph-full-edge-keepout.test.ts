import { expect, test } from "bun:test"
import { PreloadedTraceGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("reserves every existing port when fixed copper blocks the full edge", () => {
  const sharedEdgeSegments: SharedEdgeSegment[] = [
    {
      edgeId: "shared-edge",
      nodeIds: ["left", "right"],
      start: { x: 0, y: -0.5 },
      end: { x: 0, y: 0.5 },
      availableZ: [0],
      portPoints: [-0.25, 0, 0.25].map((y, portIndex) => ({
        segmentPortPointId: `port-${portIndex}`,
        x: 0,
        y,
        availableZ: [0],
        nodeIds: ["left", "right"],
        edgeId: "shared-edge",
        connectionName: null,
        distToCentermostPortOnZ: Math.abs(y),
        cramped: false,
      })),
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.15,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "fixed-net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 0, y: 0, layer: "bottom" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed-via-trace",
        connection_name: "fixed-net",
        route: [
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 1,
          },
        ],
      },
    ],
  }
  const fixedNetId =
    getConnectivityMapFromSimpleRouteJson(srj).getNetConnectedToId("fixed-net")
  if (!fixedNetId) throw new Error("Expected a canonical fixed net ID")

  const solver = new PreloadedTraceGraphSolver(sharedEdgeSegments, srj)
  solver.solve()

  expect(
    sharedEdgeSegments[0]!.portPoints.map((portPoint) =>
      portPoint._preloadedCopperReservationsByZ?.find(
        (reservation) => reservation.z === 0,
      ),
    ),
  ).toEqual([
    {
      z: 0,
      reservations: [
        {
          keepoutId: "fixed-route:0:via:0:z0",
          netId: fixedNetId,
          removablePreloadedTraceSection: {
            traceId: "fixed-via-trace",
            startRoutePosition: 0,
            endRoutePosition: 0,
          },
        },
      ],
    },
    {
      z: 0,
      reservations: [
        {
          keepoutId: "fixed-route:0:via:0:z0",
          netId: fixedNetId,
          removablePreloadedTraceSection: {
            traceId: "fixed-via-trace",
            startRoutePosition: 0,
            endRoutePosition: 0,
          },
        },
      ],
    },
    {
      z: 0,
      reservations: [
        {
          keepoutId: "fixed-route:0:via:0:z0",
          netId: fixedNetId,
          removablePreloadedTraceSection: {
            traceId: "fixed-via-trace",
            startRoutePosition: 0,
            endRoutePosition: 0,
          },
        },
      ],
    },
  ])
  expect(solver.stats).toMatchObject({ fixedCopperKeepoutPortCount: 3 })
})
