import { expect, test } from "bun:test"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("component detection recognizes the 56-pin thermal-pad QFP in srj18 sample010", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 10, 1)
  const solver = new ComponentDetectionSolver({ inputSrj: scenario })

  solver.solve()

  expect(
    solver
      .getOutput()
      .find((component) => component.componentId === "pcb_component_84")
      ?.componentKind,
  ).toBe("qfp_thermalpad")
})
