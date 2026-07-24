import { expect, test } from "bun:test"
import { PreloadedTraceGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preloaded-trace-graph-solver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

test("preloaded trace projection only reserves fully covered layers", () => {
  const capacityMeshNodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "diagonal-top",
      center: { x: 0, y: 0 },
      width: 0.05,
      height: 0.05,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "coarse-diagonal-top",
      center: { x: 0, y: 0 },
      width: 0.2,
      height: 0.2,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "multilayer-diagonal",
      center: { x: 0, y: 0 },
      width: 0.05,
      height: 0.05,
      layer: "z0,1",
      availableZ: [0, 1],
    },
    {
      capacityMeshNodeId: "off-diagonal-top",
      center: { x: 0, y: 1 },
      width: 0.2,
      height: 0.2,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "via-bottom",
      center: { x: 2, y: 2 },
      width: 0.2,
      height: 0.2,
      layer: "bottom",
      availableZ: [1],
    },
    {
      capacityMeshNodeId: "wire-bottom",
      center: { x: 0, y: 2 },
      width: 0.05,
      height: 0.05,
      layer: "bottom",
      availableZ: [1],
    },
    {
      capacityMeshNodeId: "unrelated-bottom",
      center: { x: 0, y: 0 },
      width: 0.2,
      height: 0.2,
      layer: "bottom",
      availableZ: [1],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.6,
    minViaHoleDiameter: 0.3,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    obstacles: [],
    connections: [],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "preloaded-diagonal",
        connection_name: "net1",
        route: [
          {
            route_type: "wire",
            x: -2,
            y: -2,
            width: 0.1,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 2,
            y: 2,
            width: 0.1,
            layer: "top",
          },
          {
            route_type: "via",
            x: 2,
            y: 2,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 0.6,
            via_hole_diameter: 0.3,
          },
          {
            route_type: "wire",
            x: 2,
            y: 2,
            width: 0.1,
            layer: "bottom",
          },
          {
            route_type: "wire",
            x: -2,
            y: 2,
            width: 0.1,
            layer: "bottom",
          },
        ],
      },
    ],
  }

  const solver = new PreloadedTraceGraphSolver(capacityMeshNodes, srj)
  solver.solve()
  const connectedNodeIds = solver
    .getOutput()
    .filter((node) => node._connectedTo?.includes("net1"))
    .map((node) => node.capacityMeshNodeId)

  expect(connectedNodeIds).toEqual([
    "diagonal-top",
    "via-bottom",
    "wire-bottom",
  ])
  expect(solver.stats).toMatchObject({
    preloadedTraceShapeCount: 3,
    projectedNodeCount: 3,
    traceRegionAssignmentCount: 3,
  })
})
