import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { parsePrBenchmarkCommand } from "../scripts/benchmark/pr-benchmark-command.js"

test("PR benchmark commands preserve arguments and fan-out behavior", () => {
  expect(parsePrBenchmarkCommand("/profile --dataset 18")).toEqual({
    kind: "profile",
    benchmarkArgs: ["--dataset", "18"],
    datasetName: "18",
    profileSolvers: true,
    sameMachineCompare: true,
  })
  expect(parsePrBenchmarkCommand("/benchmark")).toEqual({
    kind: "benchmark",
    benchmarkArgs: [],
    datasetName: "dataset01",
    profileSolvers: false,
    sameMachineCompare: false,
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
    sameMachineCompare: false,
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
    sameMachineCompare: false,
  })
  expect(
    parsePrBenchmarkCommand("/benchmark --pipeline 10 --dataset 29"),
  ).toEqual({
    kind: "benchmark",
    benchmarkArgs: ["--pipeline", "10", "--dataset", "29"],
    datasetName: "29",
    profileSolvers: false,
    sameMachineCompare: false,
  })
  expect(
    parsePrBenchmarkCommand("/benchmark --pipeline 9net --dataset 18"),
  ).toEqual({
    kind: "benchmark",
    benchmarkArgs: ["--pipeline", "9net", "--dataset", "18"],
    datasetName: "18",
    profileSolvers: false,
    sameMachineCompare: false,
  })
  expect(() =>
    parsePrBenchmarkCommand(
      "/benchmark --pipeline 9net --dataset 18 --same-machine",
    ),
  ).toThrow("does not support --same-machine")
  expect(() =>
    parsePrBenchmarkCommand(
      "/benchmark --pipeline 9net --dataset 18 --profile-solvers",
    ),
  ).toThrow("does not support --profile-solvers")
  expect(
    parsePrBenchmarkCommand(
      "/benchmark --pipeline 10 --dataset 29 --limit 5 --sample 2",
    ),
  ).toEqual({
    kind: "benchmark",
    benchmarkArgs: [
      "--pipeline",
      "10",
      "--dataset",
      "29",
      "--limit",
      "5",
      "--sample",
      "2",
    ],
    datasetName: "29",
    profileSolvers: false,
    sameMachineCompare: false,
  })
  expect(parsePrBenchmarkCommand("/benchmark-long --dataset srj18")).toEqual({
    kind: "benchmark-long",
    benchmarkArgs: ["--concurrency", "8", "--dataset", "srj18"],
    datasetName: "srj18",
    profileSolvers: false,
    sameMachineCompare: false,
  })
  expect(parsePrBenchmarkCommand("/benchmark-long --concurrency 6")).toEqual({
    kind: "benchmark-long",
    benchmarkArgs: ["--concurrency", "6"],
    datasetName: "dataset01",
    profileSolvers: false,
    sameMachineCompare: false,
  })
  expect(parsePrBenchmarkCommand("/benchmark-all\n")).toEqual({
    kind: "benchmark-all",
    benchmarkArgs: [],
    datasetName: "dataset01",
    profileSolvers: false,
    sameMachineCompare: false,
  })
  expect(parsePrBenchmarkCommand("/benchmark --same-machine")).toEqual({
    kind: "benchmark",
    benchmarkArgs: [],
    datasetName: "dataset01",
    profileSolvers: false,
    sameMachineCompare: true,
  })
  expect(
    parsePrBenchmarkCommand(
      "/benchmark --dataset srj18 --same-machine --scenario-limit 4",
    ),
  ).toEqual({
    kind: "benchmark",
    benchmarkArgs: ["--dataset", "srj18", "--scenario-limit", "4"],
    datasetName: "srj18",
    profileSolvers: false,
    sameMachineCompare: true,
  })
  expect(parsePrBenchmarkCommand("/benchmark-all --same-machine\n")).toEqual({
    kind: "benchmark-all",
    benchmarkArgs: [],
    datasetName: "dataset01",
    profileSolvers: false,
    sameMachineCompare: true,
  })
  expect(
    parsePrBenchmarkCommand(
      "/benchmark-all --pipeline 9 --same-machine --profile-solvers",
    ),
  ).toEqual({
    kind: "benchmark-all",
    benchmarkArgs: ["--pipeline", "9"],
    datasetName: "dataset01",
    profileSolvers: true,
    sameMachineCompare: true,
  })
  expect(() => parsePrBenchmarkCommand("/benchmark-all --dataset 18")).toThrow(
    "does not accept --dataset",
  )
  expect(() => parsePrBenchmarkCommand("/benchmark-all --dataset")).toThrow(
    "does not accept --dataset",
  )
  expect(() =>
    parsePrBenchmarkCommand('/benchmark --solver "unterminated'),
  ).toThrow("Unterminated quote")

  const dispatchWorkflow = readFileSync(
    new URL("../.github/workflows/benchmark-dispatch.yml", import.meta.url),
    "utf8",
  )
  const benchmarkWorkflow = readFileSync(
    new URL("../.github/workflows/benchmark.yml", import.meta.url),
    "utf8",
  )
  const profileWorkflow = readFileSync(
    new URL("../.github/workflows/profile.yml", import.meta.url),
    "utf8",
  )
  expect(dispatchWorkflow).toContain(
    "startsWith(github.event.comment.body, '/benchmark')",
  )
  expect(dispatchWorkflow).toContain(
    "startsWith(github.event.comment.body, '/profile')",
  )
  expect(dispatchWorkflow).toContain(
    "isProfile ? 'profile.yml' : 'benchmark.yml'",
  )
  expect(dispatchWorkflow).toContain(
    "profile_args_json: JSON.stringify(command.benchmarkArgs)",
  )
  expect(dispatchWorkflow).toContain(
    "parsePrBenchmarkCommand(context.payload.comment.body)",
  )
  expect(dispatchWorkflow).toContain("['dataset01', 'srj18']")
  expect(dispatchWorkflow).toContain(
    "? [...command.benchmarkArgs, '--dataset', dataset]",
  )
  expect(dispatchWorkflow).toContain(
    "benchmark_args_json: JSON.stringify(benchmarkArgs)",
  )
  expect(dispatchWorkflow).toContain(
    "long_benchmark: String(command.kind === 'benchmark-long')",
  )
  expect(dispatchWorkflow).toContain(
    "same_machine_compare: String(command.sameMachineCompare)",
  )
  expect(benchmarkWorkflow).toContain("benchmark_args_json:")
  expect(benchmarkWorkflow).not.toContain("HD_CACHE2_BENCHMARK_CAPABILITY")
  expect(benchmarkWorkflow).not.toContain("createHmac")
  expect(
    benchmarkWorkflow.indexOf(
      "Create Pipeline9 network cache benchmark namespace",
    ),
  ).toBeLessThan(benchmarkWorkflow.indexOf("Checkout code"))
  expect(benchmarkWorkflow).toContain(
    "Verify production Pipeline9 network cache support",
  )
  expect(benchmarkWorkflow).toContain("benchmarkCacheVersionSupported")
  expect(benchmarkWorkflow).toContain(
    "body.benchmarkCacheVersionAccess !== 'open'",
  )
  expect(benchmarkWorkflow).toContain("/health")
  expect(benchmarkWorkflow).toContain("HD_CACHE2_CACHE_VERSION")
  expect(benchmarkWorkflow).toContain(
    "BENCHMARK_NETWORKED_CACHE_PROPAGATION_DELAY_MS: '65000'",
  )
  expect(benchmarkWorkflow).toContain(
    "benchmark-${repositoryId}-${runId}-${runAttempt}-${randomUUID()}",
  )
  expect(benchmarkWorkflow).toContain("Pipeline9_Networked Cold vs Hot")
  expect(benchmarkWorkflow).toContain(
    "typeof comparisonModule.isNetworkedColdHotReport === 'function'",
  )
  expect(benchmarkWorkflow).toContain(
    "names.has('Pipeline9_Networked Cold') && names.has('Pipeline9_Networked Hot')",
  )
  expect(benchmarkWorkflow).toContain("blacksmith-8vcpu-ubuntu-2404-arm")
  expect(benchmarkWorkflow).toContain("inputs.long_benchmark && 480 || 120")
  expect(benchmarkWorkflow).toContain("same_machine_compare:")
  expect(benchmarkWorkflow).toContain("inputs.same_machine_compare == true")
  expect(benchmarkWorkflow).toContain("## Same Machine Benchmark Results")
  expect(benchmarkWorkflow.match(/### Main vs PR/g)).toHaveLength(2)
  expect(
    benchmarkWorkflow.match(/benchmark-comment-comparison\.js/g),
  ).toHaveLength(2)
  expect(benchmarkWorkflow).toContain("Checkout benchmark controller")
  expect(benchmarkWorkflow).toContain(
    "working-directory: same-machine-controller",
  )
  expect(benchmarkWorkflow).toContain("same-machine-results/main")
  expect(benchmarkWorkflow).toContain("same-machine-results/pr")
  expect(benchmarkWorkflow).toContain(
    "BENCHMARK_ARGS_JSON: ${{ inputs.benchmark_args_json }}",
  )
  expect(profileWorkflow).toContain("blacksmith-8vcpu-ubuntu-2404-arm")
  expect(profileWorkflow).toContain("Profile current main")
  expect(profileWorkflow).toContain("Profile PR head")
  expect(profileWorkflow).toContain("profile-comparison.ts")
})
