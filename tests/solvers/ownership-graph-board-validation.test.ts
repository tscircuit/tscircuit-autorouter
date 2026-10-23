import { expect, test } from "bun:test"
import { OwnershipGraphIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/OwnershipGraphIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

test("graph completion still requires real board and imported pad validation with net ownership", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "pad", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0],
    portPoints: [
      { connectionName: "signal", rootConnectionName: "root", x: -2, y: 0, z: 0 },
      { connectionName: "signal", rootConnectionName: "root", x: 2, y: 0, z: 0 },
      { connectionName: "other", x: -2, y: 1.5, z: 0 },
      { connectionName: "other", x: 2, y: 1.5, z: 0 },
    ],
  }
  const pad: Obstacle = {
    type: "rect", center: { x: 0, y: 0 }, width: 0.5, height: 0.5, layers: ["top"], connectedTo: ["pcb_port_foreign"],
    circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_foreign", pcb_port_id: "pcb_port_foreign" },
  }
  const foreign = new OwnershipGraphIntraNodeSolver({ nodeWithPortPoints: node, obstacles: [pad], traceWidth: 0.1, obstacleMargin: 0.1 })
  foreign.solve()
  expect(foreign.engine!.solved).toBe(true)
  expect(foreign.solved).toBe(false)
  expect(foreign.counters.ownershipGraphValidationIssueCount).toBeGreaterThan(0)
  expect(foreign.engine!.learnedClauses).toHaveLength(0)
  const own = new OwnershipGraphIntraNodeSolver({ nodeWithPortPoints: node, obstacles: [{ ...pad, connectedTo: ["root"] }], traceWidth: 0.1, obstacleMargin: 0.1 })
  own.solve()
  expect(own.solved, own.error ?? "failed").toBe(true)
  const edge = new OwnershipGraphIntraNodeSolver({
    nodeWithPortPoints: node, traceWidth: 0.1, obstacleMargin: 0.1,
    boardGeometry: { bounds: { minX: -1.9, maxX: 1.9, minY: -2, maxY: 2 }, minBoardEdgeClearance: 0.1 },
  })
  edge.solve()
  expect(edge.engine!.solved).toBe(true)
  expect(edge.solved).toBe(false)
  expect(edge.error).toContain("board copper validation")
  expect(edge.counters.ownershipGraphValidationIssueCount).toBeGreaterThan(0)
})
