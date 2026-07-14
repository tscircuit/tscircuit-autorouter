import { type DatasetName, parseDatasetName } from "./scenarios"

// Edit this list to choose which datasets main branch benchmark artifacts publish.
// PR /benchmark comments use these artifacts for the "Main Branch Results" table.
// The command dispatches independent default, srj18, srj19, srj20, srj21, and srj23 runs.
export const MAIN_BRANCH_BENCHMARK_DATASET_INPUTS = [
  "dataset1",
  "dataset18",
  "dataset19",
  "dataset20",
  "dataset21",
  "dataset23",
] as const

export const getMainBranchBenchmarkDatasets = (): DatasetName[] => {
  const datasets = MAIN_BRANCH_BENCHMARK_DATASET_INPUTS.map((input) => {
    const datasetName = parseDatasetName(input)
    if (!datasetName) {
      throw new Error(`Unknown main branch benchmark dataset: ${input}`)
    }
    return datasetName
  })

  const seen = new Set<DatasetName>()
  for (const datasetName of datasets) {
    if (seen.has(datasetName)) {
      throw new Error(`Duplicate main branch benchmark dataset: ${datasetName}`)
    }
    seen.add(datasetName)
  }

  return datasets
}
