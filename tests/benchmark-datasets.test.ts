import { expect, test } from "bun:test"
import { getMainBranchBenchmarkDatasets } from "../scripts/benchmark/main-branch-datasets"
import {
  DATASET_NAMES,
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
  expect(parseDatasetName("dataset15")).toBe("srj15")
  expect(parseDatasetName("dataset-srj15")).toBe("srj15")
  expect(parseDatasetName("16")).toBe("srj16")
  expect(parseDatasetName("dataset16")).toBe("srj16")
  expect(parseDatasetName("dataset-srj16-bga-breakouts")).toBe("srj16")
  expect(parseDatasetName("19")).toBe("srj19")
  expect(parseDatasetName("dataset19")).toBe("srj19")
  expect(parseDatasetName("dataset-srj19-bga-passive-overlays")).toBe("srj19")
  expect(parseDatasetName("20")).toBe("srj20")
  expect(parseDatasetName("dataset20")).toBe("srj20")
  expect(parseDatasetName("dataset-srj20-partial-bga-breakouts")).toBe("srj20")
})

test("main branch benchmark dataset config resolves to canonical dataset names", () => {
  const datasets = getMainBranchBenchmarkDatasets()

  expect(datasets.length).toBeGreaterThan(0)
  expect(new Set(datasets).size).toBe(datasets.length)
  for (const dataset of datasets) {
    expect(DATASET_NAMES).toContain(dataset)
  }
})

test("srj11, srj12, srj13, srj15, srj16, srj19, and srj20 benchmark datasets load in sample order", async () => {
  const srj11Scenarios = await loadScenarios("srj11")
  const srj12Scenarios = await loadScenarios("srj12")
  const srj13Scenarios = await loadScenarios("srj13")
  const srj15Scenarios = await loadScenarios("srj15")
  const srj16Scenarios = await loadScenarios("srj16")
  const srj19Scenarios = await loadScenarios("srj19")
  const srj20Scenarios = await loadScenarios("srj20")

  expect(srj11Scenarios).toHaveLength(26)
  expect(srj11Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj11Scenarios[25][0]).toBe("sample026Circuit")
  expect(srj11Scenarios[0][1].bounds).toBeDefined()

  expect(srj12Scenarios).toHaveLength(10)
  expect(srj12Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj12Scenarios[9][0]).toBe("sample010Circuit")
  expect(srj12Scenarios[0][1].bounds).toBeDefined()

  expect(srj13Scenarios).toHaveLength(50)
  expect(srj13Scenarios[0][0]).toBe("example_01")
  expect(srj13Scenarios[49][0]).toBe("example_50")
  expect(srj13Scenarios[0][1].bounds).toBeDefined()

  expect(srj15Scenarios).toHaveLength(55)
  expect(srj15Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj15Scenarios[24][0]).toBe("sample025Circuit")
  expect(srj15Scenarios[0][1].connections.length).toBeGreaterThan(0)

  expect(srj16Scenarios).toHaveLength(200)
  expect(srj16Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj16Scenarios[199][0]).toBe("sample200Circuit")
  expect(srj16Scenarios[0][1].connections.length).toBeGreaterThan(0)

  expect(srj19Scenarios).toHaveLength(200)
  expect(srj19Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj19Scenarios[199][0]).toBe("sample200Circuit")
  expect(srj19Scenarios[0][1].connections.length).toBeGreaterThan(0)

  expect(srj20Scenarios).toHaveLength(200)
  expect(srj20Scenarios[0][0]).toBe("sample001Circuit")
  expect(srj20Scenarios[199][0]).toBe("sample200Circuit")
  expect(srj20Scenarios[0][1].connections.length).toBeGreaterThan(0)

  const sample11 = await loadScenarioBySampleNumber("srj11", 11)
  expect(sample11.scenarioName).toBe("sample011Circuit")
  expect(sample11.totalSamples).toBe(26)

  const sample13 = await loadScenarioBySampleNumber("srj13", 13)
  expect(sample13.scenarioName).toBe("example_13")
  expect(sample13.totalSamples).toBe(50)

  const sample16 = await loadScenarioBySampleNumber("srj16", 16)
  expect(sample16.scenarioName).toBe("sample016Circuit")
  expect(sample16.totalSamples).toBe(200)

  const sample19 = await loadScenarioBySampleNumber("srj19", 19)
  expect(sample19.scenarioName).toBe("sample019Circuit")
  expect(sample19.totalSamples).toBe(200)

  const sample20 = await loadScenarioBySampleNumber("srj20", 20)
  expect(sample20.scenarioName).toBe("sample020Circuit")
  expect(sample20.totalSamples).toBe(200)
})
