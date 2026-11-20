import { expect, test } from "bun:test"
import {
  InitialBgaTopologySolver,
  type InitialBgaTopologySolverInput,
} from "lib/solvers/BgaTopologyGeneratorSolver/InitialBgaTopologySolver"
import initialBgaInput from "../../fixtures/bug-reports/bugreport104-initial-bga-topology.json" with {
  type: "json",
}

test("InitialBgaTopologySolver does not allocate pad layer for narrow BGA pad gaps", (): void => {
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
})
