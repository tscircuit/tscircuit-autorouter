import type { PowerTraceExpanderOptions } from "@tscircuit/power-trace-expander"
import { expect, test } from "bun:test"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { SimpleRouteJson } from "lib/types"
import constructorArgsJson from "../../fixtures/bug-reports/bugreport98-mangopi-r3c-power-expansion-iteration-limit/bugreport98-mangopi-r3c-power-expansion-iteration-limit.input.json" with {
  type: "json",
}

const [inputSrj, options] = constructorArgsJson as [
  SimpleRouteJson,
  PowerTraceExpanderOptions,
]

test("bugreport98 completes MangoPi power-trace expansion", () => {
  // This historical input contains a through-obstacle marker that falls inside
  // an oval pad's rectangular approximation but outside its actual copper. The
  // expander must fail closed and preserve that unsupported baseline exactly.
  const solver = new PowerTraceExpansionSolver(
    structuredClone(inputSrj),
    structuredClone(options),
  )

  solver.solve()

  const output = solver.getOutput()
  const childSolver = solver.powerTraceExpanderSolver
  expect(solver.error).toBeNull()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(childSolver.error).toBeNull()
  expect(childSolver.iterations).toBeLessThanOrEqual(8_000_000)
  expect(childSolver.stats).toMatchObject({
    budgetLimitedExpansion: true,
    finalAcceptanceUsed: false,
    cleanupCompleted: true,
    clearanceRepairCompleted: true,
    cleanupStatus: "connectivity_rollback",
    clearanceRepairStatus: "connectivity_rollback",
    connectivityRollbackCount: 2,
    connectivityRollbackPhases: ["cleanup", "clearance-repair"],
    completionReason: "connectivity_rollback",
    resultStatus: "best_effort",
  })
  expect(childSolver.stats.connectivityValidationError).toContain(
    "through_obstacle has no same-net multilayer obstacle witness",
  )
  expect(output).toEqual(inputSrj.traces ?? [])
  expect(output).toHaveLength(405)
  expect(new Set(output.map((trace) => trace.pcb_trace_id)).size).toBe(405)
})
