import { expect, test } from "bun:test"
import {
  loadScenarioBySampleNumber,
  loadScenarios,
  parseDatasetName,
} from "../scripts/benchmark/scenarios"

test("benchmark dataset aliases resolve to canonical dataset names", () => {
  expect(parseDatasetName("1")).toBe("dataset01")
  expect(parseDatasetName("dataset01")).toBe("dataset01")
  expect(parseDatasetName("11")).toBe("srj11")
  expect(parseDatasetName("dataset-srj11-45-degree")).toBe("srj11")
  expect(parseDatasetName("12")).toBe("srj12")
  expect(parseDatasetName("dataset-srj12-bus-routing")).toBe("srj12")
})

test("srj11 and srj12 benchmark datasets load in sample order", async () => {
  const srj11Scenarios = await loadScenarios("srj11")
  const srj12Scenarios = await loadScenarios("srj12")

  expect(srj11Scenarios).toHaveLength(20)
  expect(srj11Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj11Scenarios[19][0]).toBe("sample020Circuit")
  expect(srj11Scenarios[0][1].bounds).toBeDefined()

  expect(srj12Scenarios).toHaveLength(10)
  expect(srj12Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj12Scenarios[9][0]).toBe("sample010Circuit")
  expect(srj12Scenarios[0][1].bounds).toBeDefined()

  const sample11 = await loadScenarioBySampleNumber("srj11", 11)
  expect(sample11.scenarioName).toBe("sample011Circuit")
  expect(sample11.totalSamples).toBe(20)
})
