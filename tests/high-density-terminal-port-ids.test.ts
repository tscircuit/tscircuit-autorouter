import { expect, test } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("HighDensitySolver carries PCB terminal identities onto route endpoints", () => {
  const start = {
    connectionName: "terminal-test",
    portPointId: "start",
    pcb_port_id: "pcb_port_start",
    x: 0,
    y: 0,
    z: 0,
  }
  const end = {
    connectionName: "terminal-test",
    portPointId: "end",
    pcb_port_id: "pcb_port_end",
    x: 2,
    y: 0,
    z: 0,
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "terminal-node",
    center: { x: 1, y: 0 },
    width: 2,
    height: 1,
    availableZ: [0, 1],
    portPoints: [start, end],
    portPointsInPairs: [[start, end]],
  }
  const solver = new HighDensitySolver({
    nodePortPoints: [node],
    layerCount: 2,
    obstacles: [],
    preserveTerminalPcbPortIds: true,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.routes).toHaveLength(1)
  const route = solver.routes[0]!
  expect([route.startPcbPortId, route.endPcbPortId].sort()).toEqual([
    "pcb_port_end",
    "pcb_port_start",
  ])
})
