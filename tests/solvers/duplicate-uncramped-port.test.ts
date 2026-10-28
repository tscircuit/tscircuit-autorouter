import { expect, test } from "bun:test"
import { CapacityLimitedPortDuplicationSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/CapacityLimitedPortDuplicationSolver"

test("congestion repair duplicates spacious ports while preserving cramped capacity", (): void => {
  const solver = new CapacityLimitedPortDuplicationSolver({
    regions: [
      {
        regionId: "left",
        pointIds: ["cramped"],
        d: { width: 2, height: 2 },
      },
      {
        regionId: "middle",
        pointIds: ["cramped", "spacious"],
        d: { width: 1, height: 2 },
      },
      {
        regionId: "right",
        pointIds: ["spacious"],
        d: { width: 2, height: 2 },
      },
    ],
    ports: [
      {
        portId: "cramped",
        region1Id: "middle",
        region2Id: "left",
        d: { x: 0, y: 0, z: 0, cramped: true, allowDuplication: false },
      },
      {
        portId: "spacious",
        region1Id: "middle",
        region2Id: "right",
        d: { x: 1, y: 0, z: 0 },
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
    "cramped",
    "spacious",
    "spacious::dup1",
  ])
  expect(
    solver.report.duplicatedPorts.map((port) => port.sourcePortId),
  ).toEqual(["spacious"])
  expect(solver.report.portUseCounts.cramped).toBe(2)
})
