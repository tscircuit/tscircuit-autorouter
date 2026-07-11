import { expect, test } from "bun:test"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("component detection excludes overlapping local-topology candidates in srj18 sample001", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 1, 1)
  const solver = new ComponentDetectionSolver({ inputSrj: scenario })

  solver.solve()

  expect(
    solver
      .getOutput()
      .some(
        (component) =>
          component.componentId === "pcb_component_36" ||
          component.componentId === "pcb_component_47",
      ),
  ).toBe(false)
})
