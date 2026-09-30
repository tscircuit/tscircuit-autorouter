import { expect, test } from "bun:test"
import { parsePrBenchmarkCommand } from "../scripts/benchmark/pr-benchmark-command.js"

test("effort command fixes dataset18 and the comparison matrix", (): void => {
  expect(parsePrBenchmarkCommand("/benchmark-effort")).toEqual({
    kind: "benchmark-effort",
    benchmarkArgs: [],
    datasetName: "srj18",
    profileSolvers: false,
    sameMachineCompare: false,
  })
  for (const suffix of [" --effort 5", " --dataset 1", " --pipeline 9net"]) {
    expect(() => parsePrBenchmarkCommand(`/benchmark-effort${suffix}`)).toThrow()
  }
})
