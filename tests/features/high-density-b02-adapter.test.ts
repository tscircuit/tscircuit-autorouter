import { expect, test } from "bun:test"
import { HighDensitySolverB02IntraNodeAdapter } from "lib/solvers/HighDensitySolver/high-density-solver-b02-adapter"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("HighDensitySolverB02 adapter preserves explicit pair metadata", () => {
  const portPoints = [
    {
      portPointId: "a-start",
      pcb_port_id: "pcb-a",
      x: -1.5,
      y: -0.5,
      z: 0,
      connectionName: "a",
      rootConnectionName: "root-a",
    },
    {
      portPointId: "a-end",
      x: 1.5,
      y: -0.5,
      z: 0,
      connectionName: "a",
      rootConnectionName: "root-a",
    },
    {
      portPointId: "b-start",
      x: -1.5,
      y: 0.5,
      z: 1,
      connectionName: "b",
      rootConnectionName: "root-b",
    },
    {
      portPointId: "b-end",
      pcb_port_id: "pcb-b",
      x: 1.5,
      y: 0.5,
      z: 1,
      connectionName: "b",
      rootConnectionName: "root-b",
    },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "b02-node",
    center: { x: 0, y: 0 },
    width: 4,
    height: 3,
    availableZ: [0, 1],
    portPoints,
    portPointsInPairs: [
      [portPoints[0]!, portPoints[1]!],
      [portPoints[2]!, portPoints[3]!],
    ],
  }
  const solver = new HighDensitySolverB02IntraNodeAdapter({
    nodeWithPortPoints: node,
    traceWidth: 0.15,
    viaDiameter: 0.3,
    clearance: 0.1,
    obstacles: [],
    effort: 1,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.solvedRoutes).toHaveLength(2)
  expect(solver.solvedRoutes[0]).toMatchObject({
    connectionName: "a",
    rootConnectionName: "root-a",
    regionId: "b02-node",
    startPcbPortId: "pcb-a",
  })
  expect(solver.solvedRoutes[1]).toMatchObject({
    connectionName: "b",
    rootConnectionName: "root-b",
    regionId: "b02-node",
    endPcbPortId: "pcb-b",
  })
  expect(
    (solver.solvedRoutes[0]!.route[0] as { portPointId?: string }).portPointId,
  ).toBe("a-start")
  expect(
    (solver.solvedRoutes[0]!.route.at(-1) as { portPointId?: string })
      .portPointId,
  ).toBe("a-end")

  const nodeWithDuplicatedTerminal = structuredClone(node)
  Object.assign(nodeWithDuplicatedTerminal.portPointsInPairs![0]![0], {
    duplicatedFromPortId: "original-port",
  })
  expect(
    HighDensitySolverB02IntraNodeAdapter.isApplicable({
      nodeWithPortPoints: nodeWithDuplicatedTerminal,
      obstacles: [],
    }),
  ).toBeFalse()
})
