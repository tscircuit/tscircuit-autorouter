import { test, expect } from "bun:test"
import { JumperPrepatternSolver } from "lib/solvers/JumperPrepatternSolver"
import input from "../../../fixtures/jumper-prepattern/prepattern01-input.json" with {
  type: "json",
}

test("prepattern01-staggered - solves prepattern routes", () => {
  const solver = new JumperPrepatternSolver({
    nodeWithPortPoints: input.nodeWithPortPoints as any,
    colorMap: input.colorMap,
    hyperParameters: {
      PATTERN_TYPE: "staggered_grid",
    },
    traceWidth: input.traceWidth,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
