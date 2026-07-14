import { expect, test } from "bun:test"
import { getMainBranchBenchmarkDatasets } from "../scripts/benchmark/main-branch-datasets"

test("main branch benchmark dataset config resolves to canonical dataset names", () => {
  const datasets = getMainBranchBenchmarkDatasets()

  expect(datasets).toEqual([
    "dataset01",
    "srj18",
    "srj19",
    "srj20",
    "srj21",
    "srj23",
  ])
})
