import { profile } from "bun:jsc"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { gzipSync, gunzipSync } from "node:zlib"

type Capture = { sample: number; phase: number; input: Record<string, unknown> & {
  connectivityNetMap: Record<string, string[]>
  connectivityIdToNetMap: Record<string, string>
} }

const sourceRoot = process.env.LOOKAHEAD_PROFILE_ROOT
const sourceRevision = process.env.LOOKAHEAD_PROFILE_SHA
const destination = process.env.LOOKAHEAD_PROFILE_OUTPUT
if (!sourceRoot || !sourceRevision || !destination) {
  throw new Error("LOOKAHEAD_PROFILE_ROOT, LOOKAHEAD_PROFILE_SHA and LOOKAHEAD_PROFILE_OUTPUT must identify one immutable source snapshot")
}
const sourcePath = (name: string): string => resolve(sourceRoot, name)
const output = resolve(destination)
const { MultiSimplifiedPathSolver } = await import(sourcePath("node_modules/@tscircuit/trace-simplification-solver/index.ts"))
const { ParallelMultiSimplifiedPathSolver } = await import(sourcePath("lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiSimplifiedPathSolver.ts"))
const { Pipeline9LocalWorkerPool } = await import(sourcePath("lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool.ts"))
const { restoreWorkerConnectivityMap } = await import(sourcePath("lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/restoreWorkerConnectivityMap.ts"))
const { initializeReferenceDrcRuntime } = await import(sourcePath("lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime.ts"))
await initializeReferenceDrcRuntime()
const fixturePath = "tests/fixtures/parallel-path-lookahead/srj18-native-phases.json.gz"
const fixtureBytes = new Uint8Array(await readFile(sourcePath(fixturePath)))
const captures = JSON.parse(gunzipSync(fixtureBytes).toString()) as Capture[]
const pool = new Pipeline9LocalWorkerPool({ workerCount: 4, contextTransport: "bun-shared" })
const rows: Array<Record<string, unknown>> = []
const actuals: Array<InstanceType<typeof ParallelMultiSimplifiedPathSolver>> = []
const controls: Array<InstanceType<typeof MultiSimplifiedPathSolver>> = []
try {
  await pool.warmup()
  for (const capture of captures) {
    const { connectivityNetMap, connectivityIdToNetMap, ...params } = capture.input
    const config = { ...params, connMap: restoreWorkerConnectivityMap({ connectivityNetMap, connectivityIdToNetMap }) }
    const control = new MultiSimplifiedPathSolver(config)
    control.solve()
    if (!control.solved || control.failed) throw new Error("Original Native phase failed")
    controls.push(control)
    actuals.push(new ParallelMultiSimplifiedPathSolver({ ...config, workerPool: pool, workerCount: 4, useCertifiedLookahead: true }))
  }
  const report = await profile(async (): Promise<void> => {
    for (const actual of actuals) await actual.solveAsync()
  }, 1000)
  for (let index = 0; index < captures.length; index++) {
    const actual = actuals[index]!
    const control = controls[index]!
    const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")
    const originalHash = hash(control.simplifiedHdRoutes)
    if (!actual.solved || actual.failed || hash(actual.simplifiedHdRoutes) !== originalHash || actual.iterations !== control.iterations ||
      actual.MAX_ITERATIONS !== control.MAX_ITERATIONS || actual.currentUnsimplifiedHdRouteIndex !== control.currentUnsimplifiedHdRouteIndex ||
      actual.progress !== control.progress || actual.error !== control.error || actual.activeSubSolver !== null) {
      throw new Error(`Native state mismatch in phase ${index}`)
    }
    rows.push({ sample: captures[index]!.sample, phase: captures[index]!.phase, nativeGeometryHash: originalHash,
      nativeIterations: control.iterations, nativeRouteCount: control.simplifiedHdRoutes.length, stats: { ...actual.stats } })
  }
  const self = new Map<string, number>()
  const inclusive = new Map<string, number>()
  for (const trace of report.stackTraces.traces) {
    const first = trace.frames[0]?.name ?? ""
    self.set(first, (self.get(first) ?? 0) + 1)
    for (const name of new Set(trace.frames.map((frame) => frame.name))) inclusive.set(name, (inclusive.get(name) ?? 0) + 1)
  }
  const sourceFiles = ["lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiSimplifiedPathSolver.ts",
    "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadCoordinator.ts",
    "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createParallelPathLookaheadEligibility.ts",
    "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathQueryCertifier.ts",
    "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPathLookaheadExecutor.ts"]
  const sourceHashes: Record<string, string> = {}
  for (const name of sourceFiles) sourceHashes[name] = createHash("sha256").update(new Uint8Array(await readFile(sourcePath(name)))).digest("hex")
  const hotSpots = [...inclusive].map(([name, samples]) => ({ name, selfSamples: self.get(name) ?? 0,
    inclusiveSamples: samples, inclusiveShare: samples / report.stackTraces.traces.length })).sort((a, b) => b.inclusiveSamples - a.inclusiveSamples)
  const summary = { kind: "unmodified-native-lookahead-coordinator-cpu-attribution", noTimingComparison: true,
    sourceRevision, sourceHashes, fixtureSha256: createHash("sha256").update(fixtureBytes).digest("hex"),
    profileScope: "one async span across all six actual four-worker phases; preparation, control solves and assertions excluded; worker CPU excluded",
    samples: report.stackTraces.traces.length, hotSpots, rows, workerPoolStats: { ...pool.stats } }
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, "profile.json.gz"), new Uint8Array(gzipSync(JSON.stringify(report))))
  await writeFile(resolve(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n")
  console.log(JSON.stringify({ ...summary, hotSpots: hotSpots.slice(0, 18), rows: rows.map((row) => ({ sample: row.sample, phase: row.phase,
    nativeRouteCount: row.nativeRouteCount, nativeGeometryHash: row.nativeGeometryHash })) }, null, 2))
} finally {
  pool.dispose()
}
