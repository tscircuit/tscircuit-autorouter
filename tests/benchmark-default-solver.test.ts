import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const pipeline9SolverName = "AutoroutingPipelineSolver9_PreloadedTraceGraph"

test("benchmark entrypoints default to Pipeline 9", () => {
  const benchmarkScript = readFileSync(
    new URL("../benchmark.sh", import.meta.url),
    "utf8",
  )
  const benchmarkRunner = readFileSync(
    new URL("../scripts/benchmark/index.ts", import.meta.url),
    "utf8",
  )
  const benchmarkWorkflow = readFileSync(
    new URL("../.github/workflows/benchmark.yml", import.meta.url),
    "utf8",
  )

  expect(benchmarkScript).toContain(
    `DEFAULT_SOLVER_NAME="${pipeline9SolverName}"`,
  )
  expect(benchmarkScript).toContain(
    `Running ./benchmark.sh with no parameters benchmarks only ${pipeline9SolverName}.`,
  )
  expect(benchmarkRunner).toMatch(
    new RegExp(
      `const DEFAULT_BENCHMARK_SOLVER_NAME\\s*=\\s*"${pipeline9SolverName}"`,
    ),
  )
  expect(benchmarkWorkflow).toContain(
    `default: ${pipeline9SolverName}; use "all" for all solvers`,
  )
})
