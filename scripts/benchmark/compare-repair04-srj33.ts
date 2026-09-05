import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createHash } from "node:crypto"

type BoardResult = {
  sample: string
  inputSha256: string
  solved: boolean
  timedOut: boolean
  elapsedTimeMs: number
  relaxedErrors?: object[]
  strictErrors?: object[]
  baselineReplayMatches?: boolean
  baselineReplayByteExact?: boolean
  baselineReplayMaximumNumericDifference?: number
  postRepair03RelaxedErrors?: object[]
  repair04Stats?: { regions: number; acceptedRegions: number; indexedErrors: number; referenceErrors: number }
}
type BenchmarkSummary = {
  datasetCommit: string
  mode: "baseline" | "candidate"
  denominator: number
  evaluated: number
  complete: boolean
  results: BoardResult[]
  kind?: string
}

const [baselinePath, candidatePath, outputPath, currentManifestPath, pinnedManifestPath] = process.argv.slice(2)
if (!baselinePath || !candidatePath || !outputPath) {
  throw new Error("Usage: bun scripts/benchmark/compare-repair04-srj33.ts baseline/summary.json candidate/summary.json comparison.json [current-manifest.json pinned-manifest.json]")
}
const baseline: BenchmarkSummary = JSON.parse(await readFile(resolve(baselinePath), "utf8"))
const candidate: BenchmarkSummary = JSON.parse(await readFile(resolve(candidatePath), "utf8"))
const expectedCommit = "f566b62be0f83395d9ab63ddc068f9d645b68b16"
const expectedSampleNames = [1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 20, 25, 32, 33,
  34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51,
  52, 53, 54, 55, 56].map((id) => `sample${String(id).padStart(3, "0")}`)
for (const summary of [baseline, candidate]) {
  if (summary.datasetCommit !== expectedCommit || summary.denominator !== 37 ||
    summary.evaluated !== 37 || !summary.complete || summary.results.length !== 37) {
    throw new Error("A comparison requires complete results for all 37 boards at the pinned SRJ33 revision")
  }
  if (new Set(summary.results.map((result) => result.sample)).size !== 37) {
    throw new Error("Duplicate sample IDs in benchmark results")
  }
  if (JSON.stringify(summary.results.map((result) => result.sample).sort()) !== JSON.stringify(expectedSampleNames)) {
    throw new Error("Sample IDs differ from the pinned 37-board SRJ33 membership")
  }
}
if (baseline.mode !== "baseline" || candidate.mode !== "candidate") {
  throw new Error("Expected baseline followed by candidate results")
}
if (candidate.kind === "checkpoint-replay" && candidate.results.some((result) =>
  result.solved && result.baselineReplayMatches !== true)) {
  throw new Error("A solved checkpoint candidate has no validated baseline geometry/DRC equivalence")
}
const candidateBySample = new Map(candidate.results.map((result) => [result.sample, result]))
let reportedSampleNames = expectedSampleNames
let reportedCommit = expectedCommit
let membershipProvenance: object | undefined
if (currentManifestPath || pinnedManifestPath) {
  if (!currentManifestPath || !pinnedManifestPath) throw new Error("Both dataset manifests are required for the current-membership report")
  const currentText = await readFile(resolve(currentManifestPath), "utf8")
  const pinnedText = await readFile(resolve(pinnedManifestPath), "utf8")
  type Manifest = { sampleCount: number; samples: Array<{ id: string; inputSha256: string }> }
  const current: Manifest = JSON.parse(currentText)
  const pinned: Manifest = JSON.parse(pinnedText)
  const publishedNames = [2, 3, 5, 6, 44, 45, 46, 48, 49, 50, 51, 53, 54, 55, 56]
    .map((id) => `sample${String(id).padStart(3, "0")}`)
  if (current.sampleCount !== 15 || JSON.stringify(current.samples.map((sample) => sample.id)) !== JSON.stringify(publishedNames)) {
    throw new Error("Current manifest differs from the complete published 15-board revision")
  }
  const pinnedHashes = new Map(pinned.samples.map((sample) => [sample.id, sample.inputSha256]))
  for (const sample of current.samples) {
    if (sample.inputSha256 !== pinnedHashes.get(sample.id)) throw new Error(`Published input changed for ${sample.id}`)
  }
  reportedSampleNames = publishedNames
  reportedCommit = "026a78cb005ab33dde24f2db8fefbfd8d8efa614"
  membershipProvenance = {
    selection: "Every board in the separately published current SRJ33 manifest; no board selected by repair04 outcome",
    inputFileHashesMatchPinnedManifest: true,
    currentManifestSha256: createHash("sha256").update(currentText).digest("hex"),
    pinnedManifestSha256: createHash("sha256").update(pinnedText).digest("hex"),
    originalInputFileHashes: current.samples,
    currentManifestUrl: `https://github.com/tscircuit/dataset-srj33-drc-failures/blob/${reportedCommit}/manifest.json`,
    pinnedManifestUrl: `https://github.com/tscircuit/dataset-srj33-drc-failures/blob/${expectedCommit}/manifest.json`,
  }
}
const reportedSet = new Set(reportedSampleNames)
const beforeResults = baseline.results.filter((result) => reportedSet.has(result.sample))
const afterResults = candidate.results.filter((result) => reportedSet.has(result.sample))
const denominator = reportedSampleNames.length
const boards = beforeResults.map((before) => {
  const after = candidateBySample.get(before.sample)
  if (!after || before.inputSha256 !== after.inputSha256) {
    throw new Error(`Inputs differ for ${before.sample}`)
  }
  return { sample: before.sample, inputSha256: before.inputSha256,
    beforeSolved: before.solved, afterSolved: after.solved,
    beforeRelaxedErrors: before.relaxedErrors?.length ?? null,
    afterRelaxedErrors: after.relaxedErrors?.length ?? null,
    beforeStrictErrors: before.strictErrors?.length ?? null,
    afterStrictErrors: after.strictErrors?.length ?? null,
    postRepair03RelaxedErrors: before.postRepair03RelaxedErrors?.length ?? null,
    postRepair04ReferenceErrors: after.repair04Stats?.referenceErrors ?? null,
    repair04Stats: after.repair04Stats,
    baselineReplayMatches: after.baselineReplayMatches,
    baselineReplayByteExact: after.baselineReplayByteExact,
    baselineReplayMaximumNumericDifference: after.baselineReplayMaximumNumericDifference,
    beforeElapsedTimeMs: before.elapsedTimeMs, afterElapsedTimeMs: after.elapsedTimeMs }
})
const metric = (kind: "relaxedErrors" | "strictErrors"): object => {
  const beforePasses = beforeResults.filter((result) => result.solved && result[kind]?.length === 0)
  const afterPasses = afterResults.filter((result) => result.solved && result[kind]?.length === 0)
  const beforeIds = new Set(beforePasses.map((result) => result.sample))
  const afterIds = new Set(afterPasses.map((result) => result.sample))
  const gain = afterPasses.length - beforePasses.length
  const relativeGain = beforePasses.length === 0 ? null : gain / beforePasses.length
  return { beforePassed: beforePasses.length, afterPassed: afterPasses.length,
    beforeRate: beforePasses.length / denominator, afterRate: afterPasses.length / denominator,
    additionalPassingBoards: gain, percentagePointGain: gain / denominator * 100,
    relativeGainPercent: relativeGain === null ? null : relativeGain * 100,
    relativeGainUndefinedReason: relativeGain === null ? "The baseline has zero passing boards" : null,
    meetsThirtyPercentRelativeGain: relativeGain !== null && relativeGain >= 0.3,
    meetsThirtyPercentagePointGain: gain / denominator >= 0.3,
    newlyPassing: [...afterIds].filter((sample) => !beforeIds.has(sample)),
    regressions: [...beforeIds].filter((sample) => !afterIds.has(sample)),
    errorCountRegressions: beforeResults.flatMap((before) => {
      const after = candidateBySample.get(before.sample)!
      const beforeCount = before[kind]?.length
      const afterCount = after[kind]?.length
      return beforeCount !== undefined && afterCount !== undefined && afterCount > beforeCount
        ? [{ sample: before.sample, beforeErrors: beforeCount, afterErrors: afterCount }] : []
    }) }
}
const comparison = { datasetCommit: reportedCommit, sourceBenchmarkDatasetCommit: expectedCommit,
  denominator, membershipProvenance,
  timing: candidate.kind === "checkpoint-replay"
    ? "Baseline timings cover the full pipeline. Candidate timings cover post-repair03 replay only; they are not a speed comparison."
    : "Both timings cover the full pipeline.",
  baselineCompleted: beforeResults.filter((result) => result.solved).length,
  candidateCompleted: afterResults.filter((result) => result.solved).length,
  baselineTimedOut: beforeResults.filter((result) => result.timedOut).length,
  candidateTimedOut: afterResults.filter((result) => result.timedOut).length,
  relaxedDrc: metric("relaxedErrors"), strictDrc: metric("strictErrors"), boards }
await writeFile(resolve(outputPath), JSON.stringify(comparison, null, 2))
console.log(JSON.stringify(comparison, null, 2))
