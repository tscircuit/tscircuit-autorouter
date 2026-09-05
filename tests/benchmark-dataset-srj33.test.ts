import { expect, test } from "bun:test"
import { sample001 } from "@tscircuit/dataset-srj33-drc-failures"
import {
  loadScenarioBySampleNumber,
  loadScenarios,
} from "../scripts/benchmark/scenarios"

test("SRJ33 exposes all 31 original routing inputs in report order", async () => {
  const scenarios = await loadScenarios("srj33")
  expect(scenarios.map(([name]) => name)).toEqual(
    Array.from({ length: 31 }, (_, i) => `sample${String(i + 1).padStart(3, "0")}`),
  )
  for (const [, srj] of scenarios) {
    expect(srj.connections.length).toBeGreaterThan(0)
    expect(srj.obstacles.length).toBeGreaterThan(0)
  }
  expect(scenarios[0][1].bounds).toEqual(sample001.bounds)
  expect<unknown>(scenarios[0][1].connections).toEqual(sample001.connections)
  expect<unknown>(scenarios[0][1].traces).toEqual(sample001.traces)

  const last = await loadScenarioBySampleNumber("srj33", 31, 0.5)
  expect(last.scenarioName).toBe("sample031")
  expect(last.totalSamples).toBe(31)
  expect(last.sourceLabel).toBe("srj33#31:sample031")
  expect(last.scenario).toHaveProperty("effort", 0.5)
  expect(await loadScenarios("srj33", { scenarioLimit: 2 })).toHaveLength(2)
  await expect(loadScenarioBySampleNumber("srj33", 32)).rejects.toThrow(
    "Sample 32 is out of range for dataset srj33 (31 samples)",
  )
})
