import { expect, test } from "bun:test"
import { dataset } from "@tscircuit/dataset-srj36-real-ddr"
import {
  loadScenarioBySampleNumber,
  loadScenarios,
  parseDatasetName,
} from "../scripts/benchmark/scenarios"

test("SRJ36 preserves the five real DDR workloads and their routing constraints", async () => {
  for (const alias of [
    "36",
    "srj36",
    "dataset36",
    "dataset-srj36-real-ddr",
    "@tscircuit/dataset-srj36-real-ddr",
  ]) {
    expect(parseDatasetName(alias)).toBe("srj36")
  }
  const scenarios = await loadScenarios("srj36")
  expect(scenarios.map(([name]) => name)).toEqual(Object.keys(dataset))
  expect(scenarios.map(([, srj]) => srj.layerCount)).toEqual([2, 6, 8, 6, 4])
  expect(scenarios.map(([, srj]) => srj.connections.length)).toEqual([
    53, 75, 72, 50, 96,
  ])
  expect(scenarios.map(([, srj]) => srj.obstacles.length)).toEqual([
    479, 2122, 2080, 893, 895,
  ])
  for (const [name, srj] of scenarios) {
    const original = dataset[name as keyof typeof dataset]
    expect<unknown>(srj.connections).toEqual(original.connections)
    expect<unknown>(srj.obstacles).toEqual(original.obstacles)
    expect(srj.bounds).toEqual(original.bounds)
    expect<unknown>(srj.buses).toEqual(original.buses)
    expect(srj.minTraceWidth).toBe(original.minTraceWidth)
    expect(srj.minViaPadDiameter).toBe(original.minViaPadDiameter)
    expect(srj.defaultObstacleMargin).toBe(original.defaultObstacleMargin)
  }
  expect(
    scenarios[1][1].connections.some(
      (connection) => connection.pointsToConnect.length > 2,
    ),
  ).toBeTrue()
  const last = await loadScenarioBySampleNumber("srj36", 5, 0.5)
  expect(last.scenarioName).toBe("sample005")
  expect(last.scenario).toHaveProperty("effort", 0.5)
  expect(last.totalSamples).toBe(5)
  expect(await loadScenarios("srj36", { scenarioLimit: 2 })).toHaveLength(2)
  await expect(loadScenarioBySampleNumber("srj36", 6)).rejects.toThrow(
    "Sample 6 is out of range for dataset srj36 (5 samples)",
  )
})
