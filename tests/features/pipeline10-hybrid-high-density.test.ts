import { expect, test } from "bun:test"
import { ApproximateHighDensityRouteSolver } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/ApproximateHighDensityRouteSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline10 routes component nodes exactly and simple approximate nodes directly", () => {
  const nodes: NodeWithPortPoints[] = [
    {
      capacityMeshNodeId: "component",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      _isComponentTopologyNode: true,
      portPoints: [
        { connectionName: "exact", x: -1, y: 0, z: 0 },
        { connectionName: "exact", x: 1, y: 0, z: 0 },
      ],
      portPointsInPairs: [
        [
          { connectionName: "exact", x: -1, y: 0, z: 0 },
          { connectionName: "exact", x: 1, y: 0, z: 0 },
        ],
      ],
    },
    {
      capacityMeshNodeId: "approximate",
      center: { x: 3, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [
        {
          connectionName: "approximate",
          x: 2,
          y: 0,
          z: 0,
          pcb_port_id: "start",
        },
        { connectionName: "approximate", x: 4, y: 0, z: 1 },
      ],
      portPointsInPairs: [
        [
          {
            connectionName: "approximate",
            x: 2,
            y: 0,
            z: 0,
            pcb_port_id: "start",
          },
          { connectionName: "approximate", x: 4, y: 0, z: 1 },
        ],
      ],
    },
  ]
  const solver = new ApproximateHighDensityRouteSolver({
    nodePortPoints: nodes,
    nodePfById: new Map([
      ["component", 0],
      ["approximate", 0],
    ]),
    layerCount: 2,
    traceWidth: 0.15,
    viaDiameter: 0.6,
    preserveTerminalPcbPortIds: true,
    approximateExactPfThreshold: 1,
  })

  solver.solve()

  expect(solver.stats).toMatchObject({
    approximateNodeCount: 1,
    exactNodeCount: 1,
    routeCount: 2,
  })
  expect(
    solver.routes.find((route) => route.connectionName === "approximate"),
  ).toMatchObject({
    startPcbPortId: "start",
    vias: [{ x: 3, y: 0 }],
  })
})
