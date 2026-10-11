import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { SamplingProfile } from "bun:jsc"

type FrameCount = { name: string; source: string; samples: number }
const root = resolve(import.meta.dir, "../../..")
const relativeProfile = "docs/benchmarks/native-joint-d3f96eca5/sample015-profile.json.gz"
const bytes = new Uint8Array(await readFile(join(root, relativeProfile)))
const report = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(bytes))) as SamplingProfile
const sourceUrls = new Map(report.stackTraces.sources.map((row) => [row.sourceID, row.sourceURL ?? row.url ?? ""]))
const total = report.stackTraces.traces.length
const inclusive = new Map<string, number>(), nearest = new Map<string, FrameCount>(), leaves = new Map<string, FrameCount>()
const tracked = ["getViaAndPourConnections", "prepareReferenceDrcTracePairFacts", "prepareReferenceDrcPolygonFacts", "executeParallelReferenceContinuityBatch", "execute", "executor", "wait", "postMessage", "findOrderedIndexedConnectedNetworks", "intern", "snapshotKey", "getOrCompute", "getOrCreate", "search", "finish", "createTracePortLayerConnectivity", "_arePcbTracesConnected"]
let graph = 0
for (const sample of report.stackTraces.traces) {
  const names = new Set(sample.frames.map((frame) => frame.name))
  if (!names.has("createIndexedPcbConnectivityMap")) continue
  graph++
  for (const name of tracked) if (names.has(name)) inclusive.set(name, (inclusive.get(name) ?? 0) + 1)
  const leaf = sample.frames[0]!
  const leafSource = leaf.sourceURL ?? sourceUrls.get(leaf.sourceID) ?? ""
  const leafKey = JSON.stringify([leaf.name, leafSource])
  const previousLeaf = leaves.get(leafKey)
  if (previousLeaf === undefined) leaves.set(leafKey, { name: leaf.name, source: leafSource, samples: 1 })
  else previousLeaf.samples++
  for (const frame of sample.frames) {
    const source = frame.sourceURL ?? sourceUrls.get(frame.sourceID) ?? ""
    if (!source.includes("authoritative-drc-fork") && !source.includes("NativeSyncReferenceBatchTransport") && !source.includes("nativeSourceAliasProvenance")) continue
    const key = JSON.stringify([frame.name, source]), previous = nearest.get(key)
    if (previous === undefined) nearest.set(key, { name: frame.name, source, samples: 1 })
    else previous.samples++
    break
  }
}
if (graph === 0) throw new Error("Frozen profile has no physical-graph stack")
const result = {
  kind: "Source-resolved current full Native joint-stage physical PCB graph attribution",
  frozenRevision: "d3f96eca56df3ce507cbb01d63d807731925e5cd",
  profileSha256: createHash("sha256").update(bytes).digest("hex"),
  scriptSha256: createHash("sha256").update(new Uint8Array(await readFile(import.meta.path))).digest("hex"),
  totalJointSamples: total, physicalGraphSamples: graph, shareOfWholeJoint: graph / total,
  inclusiveGroupsOverlap: true,
  graphAncestorInclusiveGroups: Object.fromEntries([...inclusive].sort((a, b) => b[1] - a[1]).map(([name, samples]) => [name, { samples, shareOfWholeJoint: samples / total, shareOfPhysicalGraph: samples / graph }])),
  exclusiveNearestOwnedMainFrames: [...nearest.values()].sort((a, b) => b.samples - a.samples),
  exclusiveLeafFrames: [...leaves.values()].sort((a, b) => b.samples - a.samples),
  noLocalElapsedComparison: true, noSpeedClaim: true,
  limitation: "This attributes original frozen whole-stage JSC samples, not a microbenchmark. Nested group shares overlap; nearest frame and leaf rows are separate exclusive partitions. Host waits and transport serialization are included. Newer depth-validation and intern-scope reductions were not present in this frozen profile, so their old frames do not justify further production changes. Worker CPU is absent; all-sample Blacksmith wall time remains acceptance evidence.",
}
await Bun.write(process.env.PCB_GRAPH_ATTRIBUTION_OUTPUT ?? "/tmp/native-pcb-connectivity-attribution.json", JSON.stringify(result, null, 2))
console.log(JSON.stringify({ totalJointSamples: total, physicalGraphSamples: graph, graphAncestorInclusiveGroups: result.graphAncestorInclusiveGroups }, null, 2))
