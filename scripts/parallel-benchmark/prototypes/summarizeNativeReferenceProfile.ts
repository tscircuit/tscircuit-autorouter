import type { SamplingProfile } from "bun:jsc"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

type FrameShare = { name: string; source: string; samples: number; shareOfContinuity: number }
const directory = resolve(process.env.REFERENCE_PROFILE_OUTPUT ?? "/tmp/native-reference-main-profile")
const bytes = new Uint8Array(await readFile(join(directory, "raw-jsc-profiles.json.gz")))
const reports = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(bytes))) as SamplingProfile[]
if (reports.length !== 1) throw new Error("Attribution requires the single all-seventeen synchronous profile span")
const report = reports[0]!
const sources = new Map(report.stackTraces.sources.map((source) => [source.sourceID, source.sourceURL ?? source.url ?? ""]))
const groups: Record<string, string[]> = {
  connectivityGraph: ["createIndexedPcbConnectivityMap"],
  viaPourGraph: ["getViaAndPourConnections"],
  primitiveMemo: ["snapshotKey", "intern", "getOrCompute", "prepareMissPlan", "consume"],
  nativeAdmission: ["canUseExpectedPortsMemo", "canUseLazyViaTraceCenters", "isPlainFiniteData", "nativeExecutionIsUnchanged"],
  contextProtocolValidation: ["assertNativeSourceAliasOutput", "prepareOutputAliases", "validateOwnedGraph", "assertParallelReferenceContinuityBatchResult", "assertNativeSyncReferenceResponse", "assertReferenceDrcPolygonSnapshot", "prepareParallelReferenceContinuityContext", "assertParallelReferenceContinuityContext", "assertParallelReferenceContinuityTask"],
  polygonFacts: ["prepareReferenceDrcPolygonFacts"],
  traceFacts: ["prepareReferenceDrcTracePairFacts"],
  mainFactExecution: ["executeParallelReferenceContinuityBatch"],
  transport: ["executor", "execute"],
  polygonConstruction: ["getOrCreate", "captureReferenceDrcPolygonSnapshotsWithinDomain", "reconstructReferenceDrcPolygon", "getTraceSegmentPolygon", "circlePolygon", "getPourPolygon"],
}
const counts = new Map<string, number>(), nearest = new Map<string, FrameShare>()
let whole = 0, continuity = 0, waits = 0
for (const trace of report.stackTraces.traces) {
  const names = new Set(trace.frames.map((frame) => frame.name))
  if (names.has("getDrcErrors")) whole++
  if (!names.has("checkTracesAreContiguous")) continue
  continuity++
  if (names.has("wait")) waits++
  for (const [group, targets] of Object.entries(groups)) {
    if (targets.some((target) => names.has(target))) counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  // This is a separate exclusive nearest-owned-frame partition. Native library
  // and builtin leaf work belongs to its nearest selected main-source caller.
  // It is not the same quantity as self samples or the overlapping groups above.
  for (const frame of trace.frames) {
    const source = frame.sourceURL ?? sources.get(frame.sourceID) ?? ""
    if (!source.includes("AutoroutingPipeline9_Parallel") && !source.includes("circuit-json-util")) continue
    const key = JSON.stringify([frame.name, source])
    const previous = nearest.get(key)
    if (previous === undefined) nearest.set(key, { name: frame.name, source, samples: 1, shareOfContinuity: 0 })
    else previous.samples++
    break
  }
}
if (continuity === 0) throw new Error("The profiler supplied no continuity samples")
const proof = {
  kind: "Source-resolved JavaScriptCore attribution of existing Native reference main work",
  noLocalElapsedComparison: true, noSpeedClaim: true,
  rawProfileSha256: createHash("sha256").update(bytes).digest("hex"),
  scriptSha256: createHash("sha256").update(new Uint8Array(await readFile(import.meta.path))).digest("hex"),
  wholeGetDrcSamples: whole, continuitySamples: continuity, explicitWaitSamples: waits,
  inclusiveGroupsOverlap: true,
  inclusiveGroupDefinitions: groups,
  inclusiveOverlappingGroups: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]).map(([name, samples]) => [name, { samples, shareOfContinuity: samples / continuity }])),
  nearestMainSourceFrames: [...nearest.values()].map((row) => ({ ...row, shareOfContinuity: row.samples / continuity })).sort((a, b) => b.samples - a.samples),
  limitation: "The 17 saved sample015 executions are a hotspot probe, not a full-dataset performance result. Native dependency/builtin work is charged to its nearest selected main-source frame. Host wait samples are neither active JS CPU work nor Blacksmith elapsed-time evidence. Group shares overlap and must not be added.",
}
await Bun.write(join(directory, "group-attribution.json"), JSON.stringify(proof, null, 2))
console.log(JSON.stringify({ wholeGetDrcSamples: whole, continuitySamples: continuity, explicitWaitSamples: waits, inclusiveOverlappingGroups: proof.inclusiveOverlappingGroups, nearestMainSourceFrames: proof.nearestMainSourceFrames.slice(0, 15) }, null, 2))
