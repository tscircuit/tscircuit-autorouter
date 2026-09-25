import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { PortPoint } from "lib/types/high-density-types"

test("IntraNode preserves coincident endpoints with mixed identity metadata", (): void => {
  const start: PortPoint = {
    x: 0,
    y: 0,
    z: 0,
    connectionName: "pair",
    portPointId: "logical-start",
  }
  const end: PortPoint = {
    x: 0,
    y: 0,
    z: 0,
    connectionName: "pair",
    pcb_port_id: "pcb-end",
  }
  const solver = new IntraNodeRouteSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "node",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      portPoints: [start, end],
      portPointsInPairs: [[start, end]],
    },
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedRoutes).toHaveLength(1)
  const [route] = solver.solvedRoutes
  expect(route.route).toHaveLength(2)
  expect(route.route[0]).toMatchObject({
    x: 0,
    y: 0,
    z: 0,
    portPointId: "logical-start",
  })
  expect(route.route[1]).toMatchObject({
    x: 0,
    y: 0,
    z: 0,
    pcb_port_id: "pcb-end",
  })
  expect(route.startPcbPortId).toBeUndefined()
  expect(route.endPcbPortId).toBe("pcb-end")
})
