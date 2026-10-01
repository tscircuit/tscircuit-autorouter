import { expect, test } from "bun:test"
import { parseArgs } from "../scripts/benchmark/index"
import { getBenchmarkSolverOptions } from "../scripts/benchmark/benchmark-run-task"
import type { SimpleRouteJson } from "lib/types"

test("fractional benchmark effort reaches the solver without truncation", (): void => {
  for (const effort of [1, 1.5, 2]) {
    const parsed = parseArgs(["--effort", String(effort)])
    expect(parsed.effort).toBe(effort)
    const scenario = { effort: parsed.effort } as unknown as SimpleRouteJson
    expect(getBenchmarkSolverOptions(scenario)?.effort).toBe(effort)
  }
  for (const value of ["", "1.5junk", "Infinity", "NaN", "0", "-2"]) {
    expect(() => parseArgs(["--effort", value])).toThrow()
  }
})
