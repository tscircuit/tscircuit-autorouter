import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

type Result = {
  sample: string
  solved: boolean
  baselineReplayMatches: boolean
  relaxedErrors?: object[]
  strictErrors?: object[]
}
type Configuration = {
  bundleSha256: string
  baselineFingerprintSha256: string
  datasetCommit: string
  bunVersion: string
  architecture: string
  platform: string
  effort: number
  concurrency: number
}
type Summary = {
  kind: string
  mode: string
  denominator: number
  evaluated: number
  bundleSha256: string
  datasetCommit: string
  results: Result[]
}

const [outputDirectory, ...sourceDirectories] = process.argv.slice(2)
if (!outputDirectory || sourceDirectories.length < 2) {
  throw new Error(
    "Usage: bun scripts/benchmark/merge-repair04-replays.ts output-directory source-directory source-directory [...]",
  )
}
const requiredKeys = [
  "bundleSha256",
  "baselineFingerprintSha256",
  "datasetCommit",
  "bunVersion",
  "architecture",
  "platform",
  "effort",
] as const
const sources: Array<{
  directory: string
  summarySha256: string
  configurationSha256: string
  configuration: Configuration
}> = []
const results: Result[] = []
let firstConfiguration: Configuration | undefined
for (const directory of sourceDirectories) {
  const summaryBytes = await readFile(resolve(directory, "summary.json"))
  const configurationBytes = await readFile(
    resolve(directory, "configuration.json"),
  )
  const summary: Summary = JSON.parse(summaryBytes.toString())
  const configuration: Configuration = JSON.parse(configurationBytes.toString())
  for (const key of requiredKeys) {
    if (
      configuration[key] === undefined ||
      configuration[key] === null ||
      configuration[key] === ""
    ) {
      throw new Error(`Missing ${key} provenance in ${directory}`)
    }
    if (firstConfiguration && configuration[key] !== firstConfiguration[key]) {
      throw new Error(`Cannot merge runs with different ${key}`)
    }
  }
  firstConfiguration ??= configuration
  if (
    summary.kind !== "checkpoint-replay" ||
    summary.mode !== "candidate" ||
    summary.denominator !== 37 ||
    summary.evaluated !== summary.results.length ||
    summary.bundleSha256 !== configuration.bundleSha256 ||
    summary.datasetCommit !== configuration.datasetCommit
  ) {
    throw new Error(`Invalid checkpoint summary in ${directory}`)
  }
  sources.push({
    directory,
    configuration,
    summarySha256: createHash("sha256")
      .update(
        new Uint8Array(
          summaryBytes.buffer,
          summaryBytes.byteOffset,
          summaryBytes.byteLength,
        ),
      )
      .digest("hex"),
    configurationSha256: createHash("sha256")
      .update(
        new Uint8Array(
          configurationBytes.buffer,
          configurationBytes.byteOffset,
          configurationBytes.byteLength,
        ),
      )
      .digest("hex"),
  })
  results.push(...summary.results)
}
const expectedNames = [
  1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 20, 25, 32, 33, 34, 35, 36, 37, 38, 39, 40,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
].map((id) => `sample${String(id).padStart(3, "0")}`)
results.sort((a, b) => a.sample.localeCompare(b.sample))
if (
  JSON.stringify(results.map((result) => result.sample)) !==
  JSON.stringify(expectedNames)
) {
  throw new Error(
    "Merged results must contain exactly one result for every pinned SRJ33 board",
  )
}
if (results.some((result) => result.solved && !result.baselineReplayMatches)) {
  throw new Error("A solved candidate lacks a validated disabled replay")
}
const configuration = firstConfiguration!
const summary = {
  kind: "checkpoint-replay",
  mode: "candidate",
  datasetCommit: configuration.datasetCommit,
  denominator: 37,
  evaluated: 37,
  complete: true,
  bundleSha256: configuration.bundleSha256,
  solved: results.filter((result) => result.solved).length,
  relaxedPassed: results.filter(
    (result) => result.solved && result.relaxedErrors?.length === 0,
  ).length,
  strictPassed: results.filter(
    (result) => result.solved && result.strictErrors?.length === 0,
  ).length,
  baselineReplayMatches: results.filter(
    (result) => result.baselineReplayMatches,
  ).length,
  results,
}
await mkdir(resolve(outputDirectory), { recursive: true })
await writeFile(
  resolve(outputDirectory, "summary.json"),
  JSON.stringify(summary, null, 2),
)
await writeFile(
  resolve(outputDirectory, "configuration.json"),
  JSON.stringify(
    {
      ...configuration,
      execution:
        "Disjoint checkpoint replay batches with matching bundle, full baseline fingerprint, runtime, and effort",
      createdAt: new Date().toISOString(),
      sources,
    },
    null,
    2,
  ),
)
console.log(
  JSON.stringify({
    evaluated: 37,
    relaxedPassed: summary.relaxedPassed,
    strictPassed: summary.strictPassed,
  }),
)
