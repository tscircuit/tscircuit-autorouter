import { expect, test } from "bun:test"
import { sample002 } from "@tscircuit/dataset-srj33-drc-failures"
import {
  loadScenarioBySampleNumber,
  loadScenarios,
} from "../scripts/benchmark/scenarios"

test("SRJ33 exposes the 15 Pipeline 9 DRC failure inputs in dataset order", async () => {
  const scenarios = await loadScenarios("srj33")
  expect(scenarios.map(([name]) => name)).toEqual(
    [2, 3, 5, 6, 44, 45, 46, 48, 49, 50, 51, 53, 54, 55, 56].map(
      (id) => `sample${String(id).padStart(3, "0")}`,
    ),
  )
  for (const [, srj] of scenarios) {
    expect(srj.connections.length).toBeGreaterThan(0)
    expect(srj.obstacles.length).toBeGreaterThan(0)
  }
  expect(scenarios[0][1].bounds).toEqual(sample002.bounds)
  expect<unknown>(scenarios[0][1].connections).toEqual(sample002.connections)
  expect<unknown>(scenarios[0][1].traces).toEqual(sample002.traces)

  const last = await loadScenarioBySampleNumber("srj33", 15, 0.5)
  expect(last.scenarioName).toBe("sample056")
  expect(last.totalSamples).toBe(15)
  expect(last.sourceLabel).toBe("srj33#15:sample056")
  expect(last.scenario).toHaveProperty("effort", 0.5)
  expect(await loadScenarios("srj33", { scenarioLimit: 2 })).toHaveLength(2)
  await expect(loadScenarioBySampleNumber("srj33", 16)).rejects.toThrow(
    "Sample 16 is out of range for dataset srj33 (15 samples)",
  )
})
