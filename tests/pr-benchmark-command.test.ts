import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { parsePrBenchmarkCommand } from "../scripts/benchmark/pr-benchmark-command.js"

test("PR benchmark commands preserve arguments and fan-out behavior", () => {
  expect(parsePrBenchmarkCommand("/benchmark")).toEqual({
    kind: "benchmark",
    benchmarkArgs: [],
    datasetName: "dataset01",
    profileSolvers: false,
  })
  expect(parsePrBenchmarkCommand("/benchmark \r\n")).toEqual(
    parsePrBenchmarkCommand("/benchmark"),
  )
  expect(
    parsePrBenchmarkCommand(
      "/benchmark --dataset 18 --sample-timeout 2000s\r\n",
    ),
  ).toEqual({
    kind: "benchmark",
    benchmarkArgs: ["--dataset", "18", "--sample-timeout", "2000s"],
    datasetName: "18",
    profileSolvers: false,
  })
  expect(
    parsePrBenchmarkCommand(
      '/benchmark --solver "Solver With Spaces" --profile-solvers',
    ),
  ).toEqual({
    kind: "benchmark",
    benchmarkArgs: ["--solver", "Solver With Spaces"],
    datasetName: "dataset01",
    profileSolvers: true,
  })
  expect(parsePrBenchmarkCommand("/benchmark-all\n")).toEqual({
    kind: "benchmark-all",
    benchmarkArgs: [],
    datasetName: "dataset01",
    profileSolvers: false,
  })
  expect(() => parsePrBenchmarkCommand("/benchmark-all --dataset 18")).toThrow()
  expect(() => parsePrBenchmarkCommand('/benchmark --solver "unterminated')).toThrow(
    "Unterminated quote",
  )

  const dispatchWorkflow = readFileSync(
    new URL("../.github/workflows/benchmark-dispatch.yml", import.meta.url),
    "utf8",
  )
  const benchmarkWorkflow = readFileSync(
    new URL("../.github/workflows/benchmark.yml", import.meta.url),
    "utf8",
  )
  expect(dispatchWorkflow).toContain(
    "startsWith(github.event.comment.body, '/benchmark')",
  )
  expect(dispatchWorkflow).toContain(
    "parsePrBenchmarkCommand(context.payload.comment.body)",
  )
  expect(dispatchWorkflow).toContain(
    "benchmark_args_json: JSON.stringify(command.benchmarkArgs)",
  )
  expect(benchmarkWorkflow).toContain("benchmark_args_json:")
})
