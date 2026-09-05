import { expect, test } from "bun:test"
import { sample001 } from "@tscircuit/dataset-srj33-drc-failures"
import {
  loadScenarioBySampleNumber,
  loadScenarios,
} from "../scripts/benchmark/scenarios"

test("SRJ33 exposes the 12 Pipeline 9 DRC failure inputs in report order", async () => {
  const scenarios = await loadScenarios("srj33")
  expect(scenarios.map(([name]) => name)).toEqual(
    [1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 20, 25].map(
      (id) => `sample${String(id).padStart(3, "0")}`,
    ),
  )
  for (const [, srj] of scenarios) {
    expect(srj.connections.length).toBeGreaterThan(0)
    expect(srj.obstacles.length).toBeGreaterThan(0)
  }
  expect(scenarios[0][1].bounds).toEqual(sample001.bounds)
  expect<unknown>(scenarios[0][1].connections).toEqual(sample001.connections)
  expect<unknown>(scenarios[0][1].traces).toEqual(sample001.traces)

  const last = await loadScenarioBySampleNumber("srj33", 12, 0.5)
  expect(last.scenarioName).toBe("sample025")
  expect(last.totalSamples).toBe(12)
  expect(last.sourceLabel).toBe("srj33#12:sample025")
  expect(last.scenario).toHaveProperty("effort", 0.5)
  expect(await loadScenarios("srj33", { scenarioLimit: 2 })).toHaveLength(2)
  await expect(loadScenarioBySampleNumber("srj33", 13)).rejects.toThrow(
    "Sample 13 is out of range for dataset srj33 (12 samples)",
  )
})
