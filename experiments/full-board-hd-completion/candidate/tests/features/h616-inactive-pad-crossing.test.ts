import { expect, test } from "bun:test"
import { createInactiveNetObstacleEdgeBlocker } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createInactiveNetObstacleEdgeBlocker"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  SimpleRouteJson,
} from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("H616 cannot cross an inactive GND pad's clearance on the top layer", (): void => {
  // Native H616 other_signals geometry: the free strip beside U2/M9 is
  // subdivided into 47 rows. ZQ chose row 43, inside the GND pad's clearance.
  const nodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "topology_merge_7125__sub_43_0",
      center: { x: -3.413750000000008, y: 7.551595744680849 },
      width: 0.01249999999998419,
      height: 0.07382978723404253,
      layer: "z0,1,2,3",
      availableZ: [0, 1, 2, 3],
    },
    {
      capacityMeshNodeId: "topology_merge_7204",
      center: { x: -3.040000000000016, y: 6.074999999999995 },
      width: 0.7349999999999994,
      height: 3.46999999999999,
      layer: "z0,1,2,3",
      availableZ: [0, 1, 2, 3],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.08,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -12, maxX: 0, minY: 0, maxY: 20 },
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        center: { x: -3.619999999999993, y: 7.739999999999992 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_610", "source_net_2"],
        offBoardConnectsTo: ["source_component_internal_connection_0"],
        netIsAssignable: true,
      },
    ],
    connections: [
      {
        name: "source_net_116",
        pointsToConnect: [
          { x: -6.91, y: 9.21, layer: "bottom" },
          { x: -4.42, y: 8.54, layer: "top" },
        ],
      },
    ],
  }
  const edges: CapacityMeshEdge[] = [
    {
      capacityMeshEdgeId: "ce31890",
      nodeIds: [nodes[0]!.capacityMeshNodeId, nodes[1]!.capacityMeshNodeId],
    },
  ]
  const input = {
    nodes,
    edges,
    traceWidth: srj.minTraceWidth,
    shouldReturnCrampedPortPoints: true,
  }
  const original = new AvailableSegmentPointSolver(input)
  original.solve()
  const originalEdge = original.getOutput()[0]!
  expect(originalEdge.availableZ).toEqual([0, 1, 2, 3])

  const isSharedEdgeLayerBlocked = createInactiveNetObstacleEdgeBlocker({
    srj,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    traceWidth: srj.minTraceWidth,
  })
  const solver = new AvailableSegmentPointSolver({
    ...input,
    isSharedEdgeLayerBlocked,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  const remaining = solver.getOutput()[0]!
  expect(remaining.availableZ).toEqual([1, 2, 3])
  expect(remaining.portPoints).toEqual(
    originalEdge.portPoints.filter((point) => point.availableZ[0] !== 0),
  )

  // A longer edge has room to move away from the pad and must remain usable.
  expect(
    isSharedEdgeLayerBlocked(
      {
        start: { x: originalEdge.start.x, y: 7.34 },
        end: originalEdge.end,
      },
      0,
    ),
  ).toBeFalse()

  const activeGround: SimpleRouteJson = {
    ...srj,
    connections: [
      ...srj.connections,
      {
        name: "source_net_2",
        pointsToConnect: [
          { x: -3.62, y: 7.74, layer: "top" },
          { x: -3.62, y: 8.54, layer: "top" },
        ],
      },
    ],
  }
  expect(
    createInactiveNetObstacleEdgeBlocker({
      srj: activeGround,
      connMap: getConnectivityMapFromSimpleRouteJson(activeGround),
      traceWidth: srj.minTraceWidth,
    })(originalEdge, 0),
  ).toBeFalse()

  for (const isFixed of [false, true]) {
    const preloadedGround: SimpleRouteJson = {
      ...srj,
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "saved-ground-trace",
          connection_name: "ground-alias",
          connectsTo: ["source_component_internal_connection_0"],
          isFixed,
          route: [
            { route_type: "wire", x: -3.62, y: 7.74, layer: "top", width: 0.1 },
            { route_type: "wire", x: -3.62, y: 8.54, layer: "top", width: 0.1 },
          ],
        },
      ],
    }
    expect(
      createInactiveNetObstacleEdgeBlocker({
        srj: preloadedGround,
        connMap: getConnectivityMapFromSimpleRouteJson(preloadedGround),
        traceWidth: srj.minTraceWidth,
      })(originalEdge, 0),
    ).toBeFalse()
  }
})
