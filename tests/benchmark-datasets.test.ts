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
  expect(parseDatasetName("13")).toBe("srj13")
  expect(parseDatasetName("dataset-srj13")).toBe("srj13")
  expect(parseDatasetName("15")).toBe("srj15")
  expect(parseDatasetName("dataset-srj15")).toBe("srj15")
  expect(parseDatasetName("16")).toBe("srj16")
  expect(parseDatasetName("dataset-srj16-bga-breakouts")).toBe("srj16")
})

test("srj11, srj12, srj13, srj15, and srj16 benchmark datasets load in sample order", async () => {
  const srj11Scenarios = await loadScenarios("srj11")
  const srj12Scenarios = await loadScenarios("srj12")
  const srj13Scenarios = await loadScenarios("srj13")
  const srj15Scenarios = await loadScenarios("srj15")
  const srj16Scenarios = await loadScenarios("srj16")

  expect(srj11Scenarios).toHaveLength(20)
  expect(srj11Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj11Scenarios[19][0]).toBe("sample020Circuit")
  expect(srj11Scenarios[0][1].bounds).toBeDefined()

  expect(srj12Scenarios).toHaveLength(10)
  expect(srj12Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj12Scenarios[9][0]).toBe("sample010Circuit")
  expect(srj12Scenarios[0][1].bounds).toBeDefined()

  expect(srj13Scenarios).toHaveLength(50)
  expect(srj13Scenarios[0][0]).toBe("example_01")
  expect(srj13Scenarios[49][0]).toBe("example_50")
  expect(srj13Scenarios[0][1].bounds).toBeDefined()

  expect(srj15Scenarios).toHaveLength(25)
  expect(srj15Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj15Scenarios[24][0]).toBe("sample025Circuit")
  expect(srj15Scenarios[0][1].connections.length).toBeGreaterThan(0)

  expect(srj16Scenarios).toHaveLength(200)
  expect(srj16Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj16Scenarios[199][0]).toBe("sample200Circuit")
  expect(srj16Scenarios[0][1].connections.length).toBeGreaterThan(0)

  const sample11 = await loadScenarioBySampleNumber("srj11", 11)
  expect(sample11.scenarioName).toBe("sample011Circuit")
  expect(sample11.totalSamples).toBe(20)

  const sample13 = await loadScenarioBySampleNumber("srj13", 13)
  expect(sample13.scenarioName).toBe("example_13")
  expect(sample13.totalSamples).toBe(50)

  const sample16 = await loadScenarioBySampleNumber("srj16", 16)
  expect(sample16.scenarioName).toBe("sample016Circuit")
  expect(sample16.totalSamples).toBe(200)
})
