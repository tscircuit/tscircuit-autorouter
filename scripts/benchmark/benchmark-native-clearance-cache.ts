import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { IntraNodeRouteSolver } from "../../lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"

type Mode = "timing" | "memory"
type Arm = "baseline" | "candidate"
type NativeCache = {
  freePlanarObstaclePointCache?: Float64Array
  freePlanarObstaclePoints?: Map<number, { x: number; y: number; z: number }>
}
type LiveCheckpoint = {
  heapBytes: number
  externalBytes: number
  managedBytes: number
  rssBytes: number
  outerIterations: number
  nativeConnectionName: string
  nativeIterations: number
  exploredNodeCount: number
  cacheEntries: number
  cacheCapacity: number | null
  cacheBytes: number | null
  stateHash: string
}
type Measurement = {
  elapsedMs: number
  elapsedSamplesMs: number[]
  outcomeHash: string
  inputHash: string
  solved: boolean
  failed: boolean
  iterations: number
  routeCount: number
  error: string | null
  checkpoint?: LiveCheckpoint
}
type Trial = Measurement & { arm: Arm; mode: Mode; trial: number }
type MemorySummary = Record<
  Arm,
  {
    heapBytes: number
    externalBytes: number
    managedBytes: number
    rssBytes: number
  }
>
type FixtureResult = {
  fixture: string
  baselineMedianMs: number
  candidateMedianMs: number
  changePct: number
  medianMemory: MemorySummary
  measurements: Trial[]
}

const fixtures = [
  "srj18-sample002-large-node.json",
  "a13-srj18-hard-node.json",
]
const candidateRoot = resolve(import.meta.dir, "../..")
const hash = (value: unknown): string => {
  const serialized = JSON.stringify(value)
  const digest = createHash("sha256")
  digest.update(serialized)
  return digest.digest("hex")
}

const captureCheckpoint = (
  solver: IntraNodeRouteSolver,
  fixture: string,
): LiveCheckpoint => {
  const limit = fixture === fixtures[0] ? 17_000 : 19_000
  while (solver.iterations < limit && !solver.solved && !solver.failed) {
    solver.step()
  }
  const native = solver.activeSubSolver
  if (
    solver.solved ||
    solver.failed ||
    !native ||
    native.solved ||
    native.failed ||
    solver.iterations !== limit
  ) {
    throw new Error(`Expected an active native solver at iteration ${limit}`)
  }
  const cacheState = native as unknown as NativeCache
  const cache = cacheState.freePlanarObstaclePointCache
  let cacheEntries = cacheState.freePlanarObstaclePoints?.size ?? 0
  if (cache) {
    for (let index = 0; index < cache.length; index += 3) {
      if (!Number.isNaN(cache[index])) cacheEntries++
    }
  }
  // The pipeline still owns this active native solver and its live cache.
  Bun.gc(true)
  const memory = process.memoryUsage()
  return {
    heapBytes: memory.heapUsed,
    externalBytes: memory.external,
    managedBytes: memory.heapUsed + memory.external,
    rssBytes: memory.rss,
    outerIterations: solver.iterations,
    nativeConnectionName: native.connectionName,
    nativeIterations: native.iterations,
    exploredNodeCount: native.exploredNodes.size,
    cacheEntries,
    cacheCapacity: cache ? cache.length / 3 : null,
    cacheBytes: cache?.byteLength ?? null,
    stateHash: hash({
      routes: solver.solvedRoutes,
      unsolvedConnections: solver.unsolvedConnections,
      iterations: solver.iterations,
      error: solver.error,
      solved: solver.solved,
      failed: solver.failed,
      native: {
        connectionName: native.connectionName,
        iterations: native.iterations,
        exploredNodes: [...native.exploredNodes],
        solvedPath: native.solvedPath,
        candidates: native.candidates
          .getTopN(Number.MAX_SAFE_INTEGER)
          .map((node) => [
            node.x,
            node.y,
            node.z,
            node.g,
            node.h,
            node.f,
            node.parent?.x,
            node.parent?.y,
            node.parent?.z,
          ]),
      },
    }),
  }
}

const runChild = async (
  root: string,
  fixture: string,
  mode: Mode,
): Promise<Measurement> => {
  const { IntraNodeRouteSolver: Solver } = (await import(
    resolve(root, "lib/solvers/HighDensitySolver/IntraNodeSolver.ts")
  )) as { IntraNodeRouteSolver: typeof IntraNodeRouteSolver }
  // Read both arms' input from the candidate checkout so fixtures cannot drift.
  const node = JSON.parse(
    readFileSync(resolve(candidateRoot, "tests/fixtures", fixture), "utf8"),
  ) as NodeWithPortPoints
  const params = {
    nodeWithPortPoints: node,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    layerCount: 2,
    captureSearchDebug: false,
  }
  // Identical warmup per fresh process; cloning stays outside timed work.
  for (let warmup = 0; warmup < 3; warmup++) {
    new Solver(structuredClone(params)).solve()
  }
  Bun.gc(true)
  const elapsedSamplesMs: number[] = []
  let solver: IntraNodeRouteSolver | undefined
  let checkpoint: LiveCheckpoint | undefined
  const hashes = new Set<string>()
  for (let repeat = 0; repeat < (mode === "timing" ? 5 : 1); repeat++) {
    const measuredParams = structuredClone(params)
    solver = undefined
    Bun.gc(true)
    const start = performance.now()
    solver = new Solver(measuredParams)
    if (mode === "memory") checkpoint = captureCheckpoint(solver, fixture)
    solver.solve()
    elapsedSamplesMs.push(performance.now() - start)
    hashes.add(
      hash({
        routes: solver.solvedRoutes,
        iterations: solver.iterations,
        error: solver.error,
        solved: solver.solved,
        failed: solver.failed,
      }),
    )
  }
  if (!solver || hashes.size !== 1) throw new Error("Repeated outcome mismatch")
  const outcome = {
    routes: solver.solvedRoutes,
    iterations: solver.iterations,
    error: solver.error,
    solved: solver.solved,
    failed: solver.failed,
  }
  return {
    elapsedMs: median(elapsedSamplesMs),
    elapsedSamplesMs,
    outcomeHash: hash(outcome),
    inputHash: hash(params),
    solved: solver.solved,
    failed: solver.failed,
    iterations: solver.iterations,
    routeCount: solver.solvedRoutes.length,
    error: solver.error,
    ...(checkpoint ? { checkpoint } : {}),
  }
}

const measure = (
  root: string,
  fixture: string,
  mode: Mode,
): Measurement => {
  const child = spawnSync(
    process.execPath,
    [import.meta.path, "--child", root, fixture, mode],
    { cwd: root, encoding: "utf8" },
  )
  if (child.error) throw child.error
  if (child.status !== 0) {
    throw new Error(`Benchmark child failed: ${child.stderr}`)
  }
  return JSON.parse(child.stdout.trim()) as Measurement
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

const main = (): void => {
  const args = process.argv.slice(2)
  const baselineIndex = args.indexOf("--baseline")
  const baseline = baselineIndex >= 0 ? args[baselineIndex + 1] : undefined
  const trialIndex = args.indexOf("--trials")
  const trials = trialIndex >= 0 ? Number(args[trialIndex + 1]) : 7
  if (!baseline || !Number.isSafeInteger(trials) || trials < 1) {
    throw new Error(
      "Usage: bun scripts/benchmark/benchmark-native-clearance-cache.ts --baseline PATH [--trials 7]",
    )
  }
  const roots: Record<Arm, string> = {
    baseline: resolve(baseline),
    candidate: candidateRoot,
  }
  const byFixture = new Map(fixtures.map((fixture) => [fixture, [] as Trial[]]))
  for (const mode of ["timing", "memory"] as const) {
    for (const fixture of fixtures) {
      for (let trial = 0; trial < trials; trial++) {
        const order: Arm[] =
          trial % 2 === 0
            ? ["baseline", "candidate"]
            : ["candidate", "baseline"]
        for (const arm of order) {
          byFixture.get(fixture)!.push({
            ...measure(roots[arm], fixture, mode),
            arm,
            mode,
            trial,
          })
        }
      }
    }
  }
  const results = fixtures.map((fixture): FixtureResult => {
    const measurements = byFixture.get(fixture)!
    const memoryRows = measurements.filter((row) => row.mode === "memory")
    if (
      new Set(measurements.map((row) => row.outcomeHash)).size !== 1 ||
      new Set(measurements.map((row) => row.inputHash)).size !== 1 ||
      memoryRows.some((row) => !row.checkpoint) ||
      new Set(memoryRows.map((row) => row.checkpoint!.stateHash)).size !== 1
    ) {
      throw new Error(`Input or route/state parity failed for ${fixture}`)
    }
    const baselineMedianMs = median(
      measurements
        .filter((row) => row.arm === "baseline" && row.mode === "timing")
        .map((row) => row.elapsedMs),
    )
    const candidateMedianMs = median(
      measurements
        .filter((row) => row.arm === "candidate" && row.mode === "timing")
        .map((row) => row.elapsedMs),
    )
    const medianMemory = {} as MemorySummary
    for (const arm of ["baseline", "candidate"] as const) {
      const rows = measurements.filter(
        (row) => row.arm === arm && row.mode === "memory",
      )
      medianMemory[arm] = {
        heapBytes: median(rows.map((row) => row.checkpoint!.heapBytes)),
        externalBytes: median(rows.map((row) => row.checkpoint!.externalBytes)),
        managedBytes: median(rows.map((row) => row.checkpoint!.managedBytes)),
        rssBytes: median(rows.map((row) => row.checkpoint!.rssBytes)),
      }
    }
    return {
      fixture,
      baselineMedianMs,
      candidateMedianMs,
      changePct: 100 * (candidateMedianMs / baselineMedianMs - 1),
      medianMemory,
      measurements,
    }
  })
  console.log(
    JSON.stringify(
      {
        runtime: process.version,
        bunVersion: Bun.version,
        trials,
        roots,
        notes:
          "Fresh process per arm and trial; alternating order; three identical warmups; median of five constructor+solve times excludes cloning and inter-run GC. All timing trials precede all memory trials. Memory children repeat once per trial and measure live heap/external/RSS after GC at fixed outer iteration 17000/19000, while the pipeline owns an active native solver. Managed memory is heapUsed+external, including typed-array backing storage. Cache entries/storage and a cache-independent live-state hash accompany every checkpoint. RSS is the checkpoint reading, not peak RSS. Memory-mode elapsed time includes checkpoint work and is excluded from timing summaries. Final route/state hashes must match after continuing to completion. Failed final outcomes are parity controls, not successful routing claims.",
        results,
      },
      null,
      2,
    ),
  )
}

if (process.argv[2] === "--child") {
  const [, , , root, fixture, mode] = process.argv
  console.log(JSON.stringify(await runChild(root!, fixture!, mode as Mode)))
} else {
  main()
}
