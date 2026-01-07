import { test, expect } from "bun:test"
import { JumperPrepatternSolver } from "lib/solvers/JumperPrepatternSolver"
import input from "../../../fixtures/jumper-prepattern/prepattern04-input.json" with {
  type: "json",
}

test.skip("JumperPrepatternSolver04 - solves prepattern routes", () => {
  const solver = new JumperPrepatternSolver({
    nodeWithPortPoints: input.nodeWithPortPoints as any,
    colorMap: input.colorMap,
    hyperParameters: input.hyperParameters as any,
    traceWidth: input.traceWidth,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
