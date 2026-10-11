import { expect, test } from "bun:test"
import { parsePrBenchmarkCommand } from "../scripts/benchmark/pr-benchmark-command.js"

test("networked PR benchmarks default to paired dataset18 runs without an eight-worker override", (): void => {
  for (const command of ["/benchmark", "/benchmark-long", "/benchmark-all"]) {
    const parsed = parsePrBenchmarkCommand(`${command} --pipeline 9net`)
    expect(parsed.datasetName).toBe("srj18")
    expect(parsed.sameMachineCompare).toBe(true)
    expect(parsed.benchmarkArgs).toEqual(["--pipeline", "9net"])
    expect(parsed.profileSolvers).toBe(false)
  }

  const explicit = parsePrBenchmarkCommand(
    "/benchmark-long --pipeline 9net --dataset 01 --concurrency 1 --networked-remote",
  )
  expect(explicit.datasetName).toBe("01")
  expect(explicit.sameMachineCompare).toBe(true)
  expect(explicit.benchmarkArgs).toEqual([
    "--pipeline",
    "9net",
    "--dataset",
    "01",
    "--concurrency",
    "1",
    "--networked-remote",
  ])
  for (const selector of [
    "--solver AutoroutingPipelineSolver9_Networked",
    "AutoroutingPipelineSolver9_Networked",
    "--pipeline 9NET",
  ]) {
    expect(
      parsePrBenchmarkCommand(`/benchmark-long ${selector}`),
    ).toMatchObject({
      datasetName: "srj18",
      sameMachineCompare: true,
    })
    expect(() => parsePrBenchmarkCommand(`/profile ${selector}`)).toThrow(
      "only supported by /benchmark",
    )
    expect(() =>
      parsePrBenchmarkCommand(`/benchmark ${selector} --profile-solvers`),
    ).toThrow("does not support --profile-solvers")
  }

  expect(parsePrBenchmarkCommand("/benchmark-long --pipeline 9")).toMatchObject(
    {
      benchmarkArgs: ["--concurrency", "8", "--pipeline", "9"],
      datasetName: "dataset01",
      sameMachineCompare: false,
    },
  )
})
