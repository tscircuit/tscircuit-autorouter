import { expect, test } from "bun:test"
import { parseArgs } from "../scripts/benchmark/index"
import { getBenchmarkThreadConcurrency } from "../scripts/benchmark/benchmarkRuntime"
import { parsePrBenchmarkCommand } from "../scripts/benchmark/pr-benchmark-command"

test("thread budgets cap samples and validate commands", (): void => {
  const memory = 256 * 1024 ** 3
  expect(getBenchmarkThreadConcurrency(32, 4, 32, memory)).toBe(6)
  expect(getBenchmarkThreadConcurrency(32, 8, 32, memory)).toBe(3)
  expect(getBenchmarkThreadConcurrency(32, 1, 32, memory)).toBe(32)
  expect(getBenchmarkThreadConcurrency(32, 4, 32, 12 * 1024 ** 3)).toBe(2)
  expect(getBenchmarkThreadConcurrency(32, 64, 8, memory)).toBe(1)
  expect(getBenchmarkThreadConcurrency(2, 4, 32, memory)).toBe(2)
  expect(parseArgs(["--threads", "4", "--concurrency", "12"]).threads).toBe(4)
  expect(parseArgs(["--concurrency", "12"]).concurrency).toBe(12)
  for (const value of ["0", "-1", "1.5", "NaN", "", "Infinity"]) {
    expect(() => parseArgs(["--threads", value])).toThrow("--threads")
    expect(() =>
      parsePrBenchmarkCommand("/benchmark --threads " + value),
    ).toThrow("--threads")
  }
  expect(() => parseArgs(["--threads"])).toThrow("--threads")
  expect(() => parseArgs(["--solver", "all", "--threads", "4"])).toThrow(
    "Pipeline9",
  )
  expect(() =>
    parsePrBenchmarkCommand("/benchmark --pipeline 9net --threads 4"),
  ).toThrow("Pipeline9")
  expect(() => parsePrBenchmarkCommand("/profile --threads 4")).toThrow(
    "--threads",
  )
  expect(() =>
    parsePrBenchmarkCommand("/benchmark --threads 4 --profile-solvers"),
  ).toThrow("--threads")
  const command = parsePrBenchmarkCommand("/benchmark --pipeline 9 --threads 8")
  expect(command.benchmarkArgs).toEqual([
    "--pipeline",
    "9",
    "--threads",
    "8",
    "--dataset",
    "srj18",
  ])
  expect(command.sameMachineCompare).toBe(true)
})
