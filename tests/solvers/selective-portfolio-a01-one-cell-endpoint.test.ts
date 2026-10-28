import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { areNodePortPointPairsConnectedByRoutes } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("selective A01 preserves distinct same-cell terminals without changing search identity or budgets", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "same-cell-terminal",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    availableZ: [0],
    portPoints: [
      { connectionName: "A", x: 0.01, y: 0.01, z: 0, pcb_port_id: "pcb_port_start" },
      { connectionName: "A", x: 0.02, y: 0.02, z: 0, pcb_port_id: "pcb_port_end" },
    ],
  }
  const params = { nodeWithPortPoints: node, traceWidth: 0.15, viaDiameter: 0.3 }
  const original = new PortfolioSingleIntraNodeSolver(params).generateSolver({ HIGH_DENSITY_A01: true }) as unknown as HighDensitySolverA01
  const selected = new PortfolioSingleIntraNodeSolver({ ...params, selectivePortfolio: true }).generateSolver({ HIGH_DENSITY_A01: true }) as unknown as HighDensitySolverA01
  expect(original.constructor).toBe(HighDensitySolverA01)
  expect(selected instanceof HighDensitySolverA01).toBe(true)
  expect(selected.getSolverName()).toBe(original.getSolverName())
  expect(selected.MAX_ITERATIONS).toBe(original.MAX_ITERATIONS)
  expect(selected.getOutput()).toEqual([])
  original.solve()
  selected.solve()
  expect(selected.solved).toBe(true)
  expect(selected.failed).toBe(false)
  expect(selected.iterations).toBe(original.iterations)
  expect(selected.MAX_ITERATIONS).toBe(original.MAX_ITERATIONS)
  expect(areNodePortPointPairsConnectedByRoutes(original.getOutput(), node)).toBe(false)
  expect(areNodePortPointPairsConnectedByRoutes(selected.getOutput(), node)).toBe(true)
  expect(selected.getOutput()[0]!.route).toEqual(node.portPoints)
  expect(selected.getOutput()).toEqual(selected.getOutput())
})
