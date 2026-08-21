import type { PowerTraceExpanderOptions } from "@tscircuit/power-trace-expander"
import { expect, test } from "bun:test"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { SimpleRouteJson } from "lib/types"
import constructorArgsJson from "../../fixtures/bug-reports/bugreport96-mangopi-r3c-power-expansion-iteration-limit/bugreport96-mangopi-r3c-power-expansion-iteration-limit.input.json" with {
  type: "json",
}

const [inputSrj, options] = constructorArgsJson as [
  SimpleRouteJson,
  PowerTraceExpanderOptions,
]

test.skip("bugreport96 completes MangoPi power-trace expansion", () => {
  const solver = new PowerTraceExpansionSolver(
    structuredClone(inputSrj),
    structuredClone(options),
  )

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
})
