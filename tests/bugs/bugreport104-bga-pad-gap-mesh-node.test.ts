import { expect, test } from "bun:test"
import {
  InitialBgaTopologySolver,
  type InitialBgaTopologySolverInput,
} from "lib/solvers/BgaTopologyGeneratorSolver/InitialBgaTopologySolver"
import initialBgaInput from "../../fixtures/bug-reports/bugreport104-initial-bga-topology.json" with {
  type: "json",
}

test.failing(
  "InitialBgaTopologySolver keeps the pad layer out of BGA pad gaps too narrow for a trace",
  (): void => {
    const solver = new InitialBgaTopologySolver(
      initialBgaInput as unknown as InitialBgaTopologySolverInput,
    )
    solver.solve()

    expect(solver.solved).toBe(true)
    const narrowPadGapNode = solver
      .getOutput()
      .find((node) =>
        node.capacityMeshNodeId.includes("cmn_v_pcb_component_7_1_4"),
      )
    expect(narrowPadGapNode?.availableZ.includes(0)).toBe(false)
  },
)
