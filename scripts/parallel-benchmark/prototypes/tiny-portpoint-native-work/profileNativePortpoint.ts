// CPU attribution and source-copy operation counts are separate runs. No elapsed
// comparison is produced. The original stage solve is the only profiled region.
import { profile } from "bun:jsc"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, resolve } from "node:path"
import { deserialize, serialize } from "node:v8"
import { gzipSync, gunzipSync } from "node:zlib"

type Frame = { name: string; sourceID: number }
type Trace = { frames: Frame[] }
type AttributionRow = { file: string; name: string; selfSamples: number; inclusiveSamples: number; selfShare: number; inclusiveShare: number }

const root = process.env.PATHING_SOURCE_ROOT
if (!root) throw new Error("PATHING_SOURCE_ROOT must identify an immutable source revision")
const sample = Number(process.argv[2] ?? 6)
const output = resolve(process.env.PATHING_PROFILE_OUTPUT ?? `/tmp/native-portpoint-${sample}`)
const operationOnly = process.env.PATHING_OPERATION_ONLY === "1"
const inputPath = process.env.PATHING_INPUT
const file = (name: string): string => resolve(root, name)
const hash = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex")
await mkdir(output, { recursive: true })

const { ParallelPortPointPathingSolver } = await import(file("lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortPointPathingSolver.ts"))
const { initializeReferenceDrcRuntime } = await import(file("lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime.ts"))
await initializeReferenceDrcRuntime()
let params: ConstructorParameters<typeof ParallelPortPointPathingSolver>[0]
let originalSerializedInput: Uint8Array | undefined
if (inputPath) {
  originalSerializedInput = new Uint8Array(gunzipSync(new Uint8Array(await readFile(inputPath))))
  params = deserialize(originalSerializedInput)
} else {
  const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import(file("lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts"))
  const { loadScenarioBySampleNumber } = await import(file("scripts/benchmark/scenarios.ts"))
  const { scenario } = await loadScenarioBySampleNumber("srj18", sample)
  const preparation = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, { effort: 1, cacheProvider: null })
  preparation.solveUntilPhase("portPointPathingSolver")
  if (preparation.failed) throw new Error(preparation.error ?? "Native preparation failed")
  const stage = preparation.pipelineDef.find((row: { solverName: string }): boolean => row.solverName === "portPointPathingSolver")
  if (!stage) throw new Error("Missing native pathing stage")
  ;[params] = stage.getConstructorParams(preparation)
}
const serialized = originalSerializedInput ?? new Uint8Array(serialize(params))
const constructorInputSha256 = hash(serialized)
await writeFile(resolve(output, "input.v8.gz"), new Uint8Array(gzipSync(serialized)))
const pathing = new ParallelPortPointPathingSolver(params, { strategy: "indexed" })
const report = operationOnly
  ? (pathing.solve(), { stackTraces: { traces: [] as Trace[], sources: [] as { sourceID: number; url: string }[] }, functions: "" })
  : profile((): void => pathing.solve())
if (pathing.failed || !pathing.solved) throw new Error(pathing.error ?? "Native pathing failed")
const metrics = pathing.getSolveGraphBenchmarkMetrics()
if (metrics) delete metrics.timeMs

const sourcePaths = [
  "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PackedDistanceAwareTinyHyperGraphSolver.ts",
  "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyRegionCostMemo.ts",
  "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyTriangularDistanceIndex.ts",
  "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pathingWasm/createTinyOrderedNeighborKernel.ts",
  "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pathingWasm/TinyNativeSynchronousScope.ts",
  "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/tiny-hypergraph-fork/SelectiveReripTinyHyperGraphSolver.ts",
  "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/tiny-hypergraph-fork/findPackedDistinctOwnerBlockerPath.ts",
]
const sourceHashes: Record<string, string> = {}
for (const name of sourcePaths) sourceHashes[name] = hash(new Uint8Array(await readFile(file(name))))
const traces = report.stackTraces.traces as Trace[]
const sourceURLs = new Map<number, string>(report.stackTraces.sources.map((source): [number, string] => [source.sourceID, source.url ?? ""]))
const rows = new Map<string, { file: string; name: string; self: number; inclusive: number }>()
const stacks = new Map<string, number>()
const phases = { primary: 0, completion: 0 }
for (const trace of traces) {
  const seen = new Set<string>()
  const completion = trace.frames.some((frame: Frame): boolean => frame.name === "tryGreedyFinalRouteAcceptance")
  phases[completion ? "completion" : "primary"]++
  for (let index = 0; index < trace.frames.length; index++) {
    const frame = trace.frames[index]!
    const name = frame.name, path = basename(sourceURLs.get(frame.sourceID) ?? ""), key = `${path}:${name}`
    let row = rows.get(key)
    if (!row) { row = { file: path, name, self: 0, inclusive: 0 }; rows.set(key, row) }
    if (index === 0) row.self++
    if (!seen.has(key)) { row.inclusive++; seen.add(key) }
  }
  const stack = trace.frames.slice(0, 8).map((frame: Frame): string => `${basename(sourceURLs.get(frame.sourceID) ?? "")}:${frame.name}`).join(" > ")
  stacks.set(stack, (stacks.get(stack) ?? 0) + 1)
}
const sourceRows: AttributionRow[] = [...rows.values()].map((row): AttributionRow => ({
  file: row.file, name: row.name, selfSamples: row.self, inclusiveSamples: row.inclusive,
  selfShare: row.self / traces.length, inclusiveShare: row.inclusive / traces.length,
})).sort((left, right): number => right.inclusiveSamples - left.inclusiveSamples)
const memo = await import(file("lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyRegionCostMemo.ts"))
const blocker = await import(file("lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/tiny-hypergraph-fork/SelectiveReripTinyHyperGraphSolver.ts"))
const labels = await import(file("lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/tiny-hypergraph-fork/findPackedDistinctOwnerBlockerPath.ts"))
type CensusModule = { getIsolatedRegionCostGuardCensus?: () => unknown; getIsolatedBlockerGeometryCensus?: () => unknown; getIsolatedBlockerLabelCensus?: () => unknown }
const regionCostGuards = (memo as CensusModule).getIsolatedRegionCostGuardCensus?.()
const blockerGeometry = (blocker as CensusModule).getIsolatedBlockerGeometryCensus?.()
const blockerLabels = (labels as CensusModule).getIsolatedBlockerLabelCensus?.()
const result = {
  kind: operationOnly ? "isolated-source-copy-operation-census" : "unmodified-native-portpath-cpu-attribution",
  noTimingComparison: true, sourceRoot: root, revision: process.env.PATHING_REVISION, sample,
  constructorInputSha256, sourceHashes, geometryHash: hash(JSON.stringify(pathing.getOutput())), metrics,
  stackSamples: traces.length, phases, sourceRows,
  topStacks: [...stacks].map(([stack, samples]): { stack: string; samples: number } => ({ stack, samples })).sort((left, right): number => right.samples - left.samples).slice(0, 30),
  regionCostGuards, blockerGeometry, blockerLabels,
}
await writeFile(resolve(output, "profile.json.gz"), new Uint8Array(gzipSync(JSON.stringify(report))))
await writeFile(resolve(output, "summary.json"), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ ...result, sourceRows: sourceRows.slice(0, 22), topStacks: undefined }, null, 2))
