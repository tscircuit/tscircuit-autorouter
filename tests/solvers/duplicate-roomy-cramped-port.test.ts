import { expect, test } from "bun:test"
import { CapacityLimitedPortDuplicationSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/CapacityLimitedPortDuplicationSolver"

test("congestion repair can duplicate cramped ports that have physical room", (): void => {
  const solver = new CapacityLimitedPortDuplicationSolver({
    regions: [
      { regionId: "left", pointIds: ["shared"], d: { width: 2, height: 2 } },
      {
        regionId: "middle",
        pointIds: ["shared", "exit"],
        d: { width: 2, height: 2 },
      },
      { regionId: "right", pointIds: ["exit"], d: { width: 2, height: 2 } },
    ],
    ports: [
      {
        portId: "shared",
        region1Id: "middle",
        region2Id: "left",
        d: { x: 0, y: 0, z: 0, cramped: true, allowDuplication: true },
      },
      {
        portId: "exit",
        region1Id: "middle",
        region2Id: "right",
        d: { x: 1, y: 0, z: 0, allowDuplication: false },
      },
    ],
    connections: [
      { connectionId: "a", startRegionId: "left", endRegionId: "right" },
      { connectionId: "b", startRegionId: "left", endRegionId: "right" },
    ],
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.getOutput().ports.map((port) => port.portId)).toEqual([
    "shared",
    "exit",
    "shared::dup1",
  ])
})
