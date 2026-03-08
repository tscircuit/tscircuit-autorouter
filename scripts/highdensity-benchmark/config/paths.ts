import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)

export const currentVersion = require("../../../package.json").version as string

const datasetEntryPath = require.resolve("high-density-dataset-z04")
const datasetDir = dirname(dirname(datasetEntryPath))

export const problemsDir = join(datasetDir, "hg-problem")
export const resultsDir = join(datasetDir, "results")
