import { expect, test } from "bun:test"
import { DATASET_NAMES, parseDatasetName } from "../scripts/benchmark/scenarios"

test("srj21 benchmark dataset aliases resolve to dataset 21", () => {
  expect(DATASET_NAMES).toContain("srj21")
  expect(parseDatasetName("21")).toBe("srj21")
  expect(parseDatasetName("dataset21")).toBe("srj21")
  expect(parseDatasetName("dataset-srj21")).toBe("srj21")
  expect(parseDatasetName("multi-component-dataset-srj01")).toBe("srj21")
  expect(parseDatasetName("@tsci/0hmX.multi-component-dataset-srj01")).toBe(
    "srj21",
  )
})
