import { expect, test } from "bun:test"
import { HighDensitySolverA13WithDrcValidation } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation"

test("A13 rejects a pad-crossing candidate before the portfolio accepts it", () => {
  const solver = new HighDensitySolverA13WithDrcValidation({
    nodeWithPortPoints: {
      capacityMeshNodeId: "pad-crossing",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0],
      portPoints: [
        { connectionName: "signal", x: -2, y: 0, z: 0 },
        { connectionName: "signal", x: 2, y: 0, z: 0 },
      ],
    },
    traceThickness: 0.1,
    traceMargin: 0.1,
    viaDiameter: 0.3,
    layerCount: 2,
    obstacles: [
      ...Array.from({ length: 2_000 }, (_, index) => ({
        type: "rect" as const,
        center: { x: 100 + index, y: 100 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: [`distant_pad_${index}`],
      })),
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["pcb_port_other"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_other",
          pcb_port_id: "pcb_port_other",
        },
      },
    ],
  })
  solver.solve()
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.stats.boardDrcIssueCount).toBeGreaterThan(0)
  expect(solver.stats.boardObstaclesChecked).toBe(1)
  expect(solver.error).toContain("board copper validation")
  const ownPadSolver = new HighDensitySolverA13WithDrcValidation({
    ...solver.validationParams,
    obstacles: solver.validationParams.obstacles.map((obstacle) => ({
      ...obstacle,
      connectedTo: [...obstacle.connectedTo, "signal"],
    })),
  })
  ownPadSolver.solve()
  expect(ownPadSolver.solved).toBeTrue()
  expect(ownPadSolver.failed).toBeFalse()
  expect(ownPadSolver.stats.boardDrcIssueCount).toBe(0)
})
